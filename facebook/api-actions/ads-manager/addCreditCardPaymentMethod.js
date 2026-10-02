import {
    createResult,
    normalizeTimeout,
} from "../education/common.js";


const defaultTimeoutMs = 60000;


export const addCreditCardPaymentMethodStatuses = Object.freeze({
    ADDED: "ADDED",
    AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
    REQUIRES_RISK_VERIFICATION: "REQUIRES_RISK_VERIFICATION",
    CARD_SAVE_REJECTED: "CARD_SAVE_REJECTED",
    CARD_ACCOUNT_LIMIT_REACHED: "CARD_ACCOUNT_LIMIT_REACHED",
    PTT_GENERATION_FAILED: "PTT_GENERATION_FAILED",
    RISK_CHECK_FAILED: "RISK_CHECK_FAILED",
    RUNTIME_MODULE_UNAVAILABLE: "RUNTIME_MODULE_UNAVAILABLE",
    RUNTIME_CONTEXT_UNAVAILABLE: "RUNTIME_CONTEXT_UNAVAILABLE",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    ERROR: "ERROR",
});


// Розпізнає відмову Meta, коли карту вже не можна прив'язати до ще одного рекламного кабінету.
function isCardAccountLimitError(message) {
    const normalized = String(message ?? "");
    return /\b4992003\b/.test(normalized)
        || /remove it from another account/i.test(normalized);
}


// Нормалізує необов'язковий рядок без збереження його поза поточним викликом.
function normalizeOptionalString(value) {
    const normalized = String(value ?? "").trim();
    return normalized || undefined;
}


// Додає банківську карту через нативні Billing і Relay модулі поточної Ads Manager вкладки.
// PAN, CVV і PTT не логуються та не повертаються з browser context.
export default async function addCreditCardPaymentMethod({
    page,
    paymentAccountId,
    cardNumber,
    securityCode,
    expiration,
    cardholderName,
    postalCode,
    countryCode = "US",
    cardholderEmail,
    cardholderPhoneNumber,
    credentialSharability,
    setDefault = false,
    recurringPaymentConsentGiven = false,
    networkTokenizationConsentGiven = false,
    businessId = null,
    timeout = defaultTimeoutMs,
}) {
    if (!page || typeof page.evaluate !== "function") {
        return createResult(false, addCreditCardPaymentMethodStatuses.INVALID_INPUT, null, {
            error: "Не передано Puppeteer page",
        });
    }

    const normalizedPaymentAccountId = String(paymentAccountId ?? "").trim();
    const normalizedCardNumber = String(cardNumber ?? "").replace(/[\s-]/g, "");
    const normalizedSecurityCode = String(securityCode ?? "").trim();
    const normalizedExpiration = String(expiration ?? "").trim();
    const normalizedCardholderName = String(cardholderName ?? "").trim();
    const normalizedPostalCode = String(postalCode ?? "").trim();
    const normalizedCountryCode = String(countryCode ?? "").trim().toUpperCase();
    const normalizedBusinessId = normalizeOptionalString(businessId) ?? null;

    if (!normalizedPaymentAccountId || !/^\d+$/.test(normalizedCardNumber)
        || !/^\d{3,4}$/.test(normalizedSecurityCode)
        || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(normalizedExpiration)
        || !normalizedCardholderName
        || !/^[A-Z]{2}$/.test(normalizedCountryCode)) {
        return createResult(false, addCreditCardPaymentMethodStatuses.INVALID_INPUT, null, {
            error: "Потрібні paymentAccountId, номер карти, CVV, expiration у форматі MM/YY, ім'я і countryCode",
        });
    }

    try {
        const runtimeResult = await page.evaluate(
            async ({
                accountId,
                pan,
                cvv,
                cardExpiration,
                name,
                zip,
                country,
                email,
                phone,
                sharability,
                shouldSetDefault,
                recurringConsent,
                tokenizationConsent,
                billingBusinessId,
                timeoutMs,
            }) => {
                const runtimeModuleNames = [
                    "RelayFBEnvironment",
                    "RelayHooks",
                    "CometRelay",
                    "BillingBuildCommitMutation",
                    "BillingBuildFetchQuery",
                    "BillingContextFactory",
                    "BillingContextFactoryFragment_fragment.graphql",
                    "BillingContextUtils",
                    "relay-runtime",
                    "BillingWizardGKConfig",
                    "BillingWizardQEConfig",
                    "BillingGKLogExposure",
                    "BillingQELogExposure",
                    "BillingCreditCardUtils",
                    "BillingCreditCardNumber",
                    "BillingProtectedString",
                    "BillingPTTUtils",
                    "BillingSaveCardCredentialStateMutation.graphql",
                    "BillingCheckRiskStateQuery.graphql",
                    "MetaConfig",
                ];

                const loadModule = (name) => {
                    try {
                        return require(name);
                    } catch {
                        const error = new Error("RUNTIME_MODULE_UNAVAILABLE");
                        error.moduleName = name;
                        throw error;
                    }
                };

                const loadCallableModule = (name, namedExports = []) => {
                    const moduleValue = loadModule(name);
                    const callable = [
                        moduleValue?.default,
                        ...namedExports.map((exportName) => moduleValue?.[exportName]),
                        moduleValue,
                    ].find((value) => typeof value === "function");

                    if (callable) return callable;

                    const exportNames = moduleValue && typeof moduleValue === "object"
                        ? Object.keys(moduleValue).join(", ")
                        : "";
                    throw new Error(
                        `${name} export is not a function (type: ${typeof moduleValue}; exports: ${exportNames})`
                    );
                };

                const moduleDiagnostics = [];
                const billingDiagnostics = [];
                let failureStage = "MODULE_PRELOAD";
                const pageContext = () => ({
                    hostname: location.hostname,
                    pathname: location.pathname,
                });
                const describeModule = (name, moduleValue) => ({
                    name,
                    type: typeof moduleValue,
                    exportNames: moduleValue && typeof moduleValue === "object"
                        ? Object.keys(moduleValue)
                        : [],
                    callableDefault: typeof moduleValue?.default === "function",
                    callableNamedExports: moduleValue && typeof moduleValue === "object"
                        ? Object.keys(moduleValue).filter(
                            (exportName) => typeof moduleValue[exportName] === "function"
                        )
                        : [],
                });

                // ТИМЧАСОВА ДІАГНОСТИКА BILLING: залишати лише структуру, без значень чи секретів.
                const describeSafeShape = (value, depth = 0) => {
                    if (value === null) return "null";
                    if (Array.isArray(value)) {
                        return {
                            type: "array",
                            length: value.length,
                            firstItems: depth < 4
                                ? value.slice(0, 2).map((item) => describeSafeShape(item, depth + 1))
                                : [],
                        };
                    }
                    if (typeof value !== "object") return typeof value;
                    if (depth >= 4) return { type: "object", truncated: true };

                    let keys = [];
                    try {
                        keys = Object.keys(value).slice(0, 40);
                    } catch {
                        return { type: "object", keysUnavailable: true };
                    }
                    const properties = {};
                    for (const key of keys) {
                        try {
                            properties[key] = describeSafeShape(value[key], depth + 1);
                        } catch {
                            properties[key] = "unreadable";
                        }
                    }
                    return {
                        type: "object",
                        keys,
                        omittedKeyCount: Math.max(0, Object.keys(value).length - keys.length),
                        properties,
                    };
                };

                const describeQuery = (query, variables) => ({
                    operationName: query?.params?.name ?? query?.operation?.name ?? null,
                    documentId: query?.params?.id ?? null,
                    variableNames: Object.keys(variables ?? {}),
                    variableTypes: Object.fromEntries(
                        Object.entries(variables ?? {}).map(([key, value]) => [key, Array.isArray(value) ? "array" : typeof value])
                    ),
                    paymentAccountIdMasked: String(variables?.paymentAccountID ?? "")
                        .replace(/\D/g, "")
                        .replace(/\d(?=\d{4})/g, "*") || null,
                });

                const fetchRelayOnce = (environment, query, variables) => new Promise(
                    (resolve, reject) => {
                        let settled = false;
                        let subscription = null;
                        subscription = loadModule("RelayHooks")
                            .fetchQuery(environment, query, variables, {
                                fetchPolicy: "network-only",
                            })
                            .subscribe({
                                next(value) {
                                    if (settled) return;
                                    settled = true;
                                    subscription?.unsubscribe?.();
                                    resolve(value);
                                },
                                error(error) {
                                    if (settled) return;
                                    settled = true;
                                    reject(error);
                                },
                                complete() {
                                    if (settled) return;
                                    settled = true;
                                    reject(new Error("RELAY_QUERY_COMPLETED_WITHOUT_RESULT"));
                                },
                            });
                    }
                );

                // ТИМЧАСОВА ДІАГНОСТИКА BILLING: query повертає reference на fragment,
                // тому перед створенням snapshots його потрібно прочитати зі сховища Relay.
                const readRelayFragment = (environment, fragment, fragmentReference) => {
                    const relayRuntime = loadModule("relay-runtime");
                    const selector = relayRuntime.getSelector(fragment, fragmentReference);
                    if (!selector || Array.isArray(selector)) {
                        const error = new Error("BILLING_FRAGMENT_SELECTOR_UNAVAILABLE");
                        error.fragmentSelectorAvailable = Boolean(selector);
                        throw error;
                    }
                    const snapshot = environment.lookup(selector);
                    if (!snapshot?.data) {
                        const error = new Error("BILLING_FRAGMENT_DATA_UNAVAILABLE");
                        error.fragmentSelectorAvailable = true;
                        error.fragmentDataAvailable = Boolean(snapshot?.data);
                        error.fragmentMissingData = Boolean(snapshot?.isMissingData);
                        throw error;
                    }
                    return {
                        data: snapshot.data,
                        isMissingData: Boolean(snapshot.isMissingData),
                    };
                };

                const commitRelayMutation = (environment, mutation, variables) => new Promise(
                    (resolve, reject) => {
                        loadModule("CometRelay").commitMutation(environment, {
                            mutation,
                            variables,
                            onCompleted: resolve,
                            onError: reject,
                        });
                    }
                );

                const execute = async () => {
                    for (const moduleName of runtimeModuleNames) {
                        try {
                            const moduleValue = loadModule(moduleName);
                            moduleDiagnostics.push(describeModule(moduleName, moduleValue));
                        } catch (error) {
                            error.failureStage = "MODULE_PRELOAD";
                            throw error;
                        }
                    }

                    const environment = loadModule("RelayFBEnvironment");
                    failureStage = "BUILD_BILLING_RUNTIME";
                    const buildCommitMutation = loadCallableModule(
                        "BillingBuildCommitMutation",
                        ["buildCommitMutation"]
                    );
                    const buildFetchQuery = loadCallableModule(
                        "BillingBuildFetchQuery",
                        ["buildFetchQuery"]
                    );
                    const billingCommitMutation = buildCommitMutation(environment, "mutation");
                    const relay = {
                        environment,
                        commitMutation: billingCommitMutation,
                        fetchQuery: buildFetchQuery(environment),
                    };
                    const billingContextFactory = loadModule("BillingContextFactory");
                    const billingContextUtils = loadModule("BillingContextUtils");
                    const gkConfig = loadModule("BillingWizardGKConfig").BillingWizardGKConfig;
                    const qeConfig = loadModule("BillingWizardQEConfig").BillingWizardQEConfig;
                    const hasBusinessId = billingBusinessId !== null;
                    failureStage = "FETCH_BILLING_CONTEXT";
                    const contextQuery = billingContextFactory.BillingContextFactoryQuery;
                    const contextVariables = {
                        hasInitCheckBusinessIds: hasBusinessId,
                        hasPaymentAccount: true,
                        initCheckBusinessIds: hasBusinessId ? [billingBusinessId] : [],
                        paymentAccountID: accountId,
                    };
                    billingDiagnostics.push({
                        event: "billing_context_query_start",
                        request: describeQuery(contextQuery, contextVariables),
                    });
                    const contextResponse = await fetchRelayOnce(
                        environment,
                        contextQuery,
                        contextVariables
                    );
                    billingDiagnostics.push({
                        event: "billing_context_query_response",
                        responseShape: describeSafeShape(contextResponse),
                    });
                    failureStage = "READ_BILLING_CONTEXT_FRAGMENT";
                    const contextFragment = loadModule(
                        "BillingContextFactoryFragment_fragment.graphql"
                    );
                    let resolvedContext;
                    try {
                        resolvedContext = readRelayFragment(
                            environment,
                            contextFragment,
                            contextResponse
                        );
                    } catch (error) {
                        billingDiagnostics.push({
                            event: "billing_context_fragment_unavailable",
                            fragmentSelectorAvailable: Boolean(error?.fragmentSelectorAvailable),
                            fragmentDataAvailable: Boolean(error?.fragmentDataAvailable),
                            fragmentMissingData: Boolean(error?.fragmentMissingData),
                        });
                        throw error;
                    }
                    billingDiagnostics.push({
                        event: "billing_context_fragment_resolved",
                        isMissingData: resolvedContext.isMissingData,
                        responseShape: describeSafeShape(resolvedContext.data),
                    });
                    failureStage = "BUILD_BILLING_CONTEXT_SNAPSHOTS";
                    const gkSnapshot = billingContextFactory
                        .buildInitCheckGKSnapshotFromResponse(resolvedContext.data);
                    const qeSnapshot = billingContextFactory
                        .buildInitCheckQESnapshotFromResponse(resolvedContext.data);

                    if (!gkSnapshot || !qeSnapshot) {
                        return {
                            status: "RUNTIME_CONTEXT_UNAVAILABLE",
                            failureStage,
                            pageContext: pageContext(),
                            contextDiagnostics: {
                                gkSnapshotAvailable: Boolean(gkSnapshot),
                                qeSnapshotAvailable: Boolean(qeSnapshot),
                                fragmentMissingData: resolvedContext.isMissingData,
                                resolvedTopLevelKeys: Object.keys(resolvedContext.data),
                                responseShape: describeSafeShape(resolvedContext.data),
                            },
                            billingDiagnostics,
                        };
                    }

                    failureStage = "BUILD_BILLING_GK_QE_CONTEXTS";
                    const updatePaymentAccountId = () => {};
                    const gk = billingContextUtils.buildGKContext(
                        gkConfig,
                        loadModule("BillingGKLogExposure").getLogGKExposure(
                            gkConfig,
                            accountId,
                            billingCommitMutation
                        ),
                        gkSnapshot,
                        accountId,
                        updatePaymentAccountId
                    );
                    const qe = billingContextUtils.buildQEContext(
                        qeConfig,
                        loadModule("BillingQELogExposure").getLogQEExposure(
                            qeConfig,
                            accountId,
                            billingCommitMutation
                        ),
                        qeSnapshot,
                        accountId,
                        updatePaymentAccountId
                    );

                    failureStage = "BUILD_CARD_NUMBER";
                    const cardUtils = loadModule("BillingCreditCardUtils");
                    const BillingCreditCardNumber = loadCallableModule(
                        "BillingCreditCardNumber"
                    );
                    const protectedString = loadModule("BillingProtectedString");
                    const pttUtils = loadModule("BillingPTTUtils");
                    pttUtils.init();

                    let formattedCardNumber;
                    try {
                        const cardNumber = new BillingCreditCardNumber(pan);
                        formattedCardNumber = cardUtils.formatCardNumber(cardNumber);
                        if (!formattedCardNumber) {
                            throw new Error("BILLING_CARD_NUMBER_FORMAT_UNAVAILABLE");
                        }
                        billingDiagnostics.push({
                            event: "billing_card_number_formatted",
                            constructorAvailable: true,
                            inputType: typeof cardNumber,
                            formattedType: typeof formattedCardNumber,
                            formattedHasTransform: typeof formattedCardNumber
                                ?.transform_DO_NOT_LOG === "function",
                        });
                    } catch (error) {
                        billingDiagnostics.push({
                            event: "billing_card_number_format_failed",
                            constructorAvailable: true,
                            error: String(error?.message ?? error),
                        });
                        throw error;
                    }

                    const card = {
                        cardHolderEmail: email,
                        cardHolderPhoneNumber: phone,
                        cardNumber: formattedCardNumber,
                        credentialSharability: sharability,
                        expiration: cardExpiration,
                        firstName: name,
                        makePrimaryCheckbox: shouldSetDefault,
                        postalCode: zip,
                        securityCode: new protectedString(cvv),
                        verifyRecurringCheckbox: recurringConsent,
                        verifyTokenizationCheckbox: tokenizationConsent,
                    };
                    const clientInfo = {
                        color_depth: String(screen.colorDepth ?? 24),
                        java_enabled: typeof navigator.javaEnabled === "function"
                            ? navigator.javaEnabled()
                            : false,
                        screen_height: String(screen.height ?? 0),
                        screen_width: String(screen.width ?? 0),
                    };
                    const pttRequirement = {
                        errorMessage: "Не вдалося створити захищений токен платіжної карти",
                        getIsPTTRequired: () => Boolean(loadModule("MetaConfig")._("494")),
                        sourceState: "save_credit_card_state_decision",
                    };
                    const input = await cardUtils.buildSaveCardCredentialInput(
                        card,
                        accountId,
                        country,
                        undefined,
                        "ADD_PM",
                        undefined,
                        false,
                        clientInfo,
                        gk,
                        qe,
                        relay,
                        undefined,
                        false,
                        null,
                        pttRequirement
                    );

                    if (!input?.platform_trust_token) {
                        return { status: "PTT_GENERATION_FAILED" };
                    }

                    const saveResponse = await commitRelayMutation(
                        environment,
                        loadModule("BillingSaveCardCredentialStateMutation.graphql"),
                        {
                            input,
                            getRiskVerificationInfoForAllCredentialsOnPaymentAccount: true,
                            paymentAccountID: accountId,
                            includeCreateNewFromOldFragment: false,
                        }
                    );
                    const savedCard = saveResponse?.xfb_billing_save_card_credential ?? null;
                    const credentialId = savedCard?.credit_card?.credential_id ?? null;
                    const verificationStatus = savedCard?.card_verification_status ?? null;

                    if (!credentialId) {
                        return {
                            status: "CARD_SAVE_REJECTED",
                            verificationStatus,
                        };
                    }
                    if (verificationStatus === "AUTHENTICATION_REQUIRED") {
                        return {
                            status: "AUTHENTICATION_REQUIRED",
                            paymentMethodId: String(credentialId),
                            verification: savedCard.card_verification ?? null,
                        };
                    }
                    if (verificationStatus !== "SUCCESS") {
                        return {
                            status: "CARD_SAVE_REJECTED",
                            paymentMethodId: String(credentialId),
                            verificationStatus,
                        };
                    }

                    try {
                        const riskResponse = await fetchRelayOnce(
                            environment,
                            loadModule("BillingCheckRiskStateQuery.graphql"),
                            {
                                paymentAccountID: accountId,
                                paymentMethodID: String(credentialId),
                                getRiskVerificationInfoForAllCredentialsOnPaymentAccount: false,
                            }
                        );
                        const riskVerification = riskResponse?.payment_account?.billable_account
                            ?.specific_credential_required_risk_verification_info ?? null;
                        if (riskVerification) {
                            return {
                                status: "REQUIRES_RISK_VERIFICATION",
                                paymentMethodId: String(credentialId),
                                riskVerification,
                            };
                        }
                    } catch {
                        return {
                            status: "RISK_CHECK_FAILED",
                            paymentMethodId: String(credentialId),
                        };
                    }

                    return {
                        status: "ADDED",
                        paymentMethodId: String(credentialId),
                        network: savedCard?.credit_card?.card_association_name ?? null,
                        last4: savedCard?.credit_card?.last_four_digits ?? null,
                    };
                };

                try {
                    return await Promise.race([
                        execute(),
                        new Promise((resolve) => setTimeout(
                            () => resolve({ status: "REQUEST_TIMEOUT" }),
                            timeoutMs
                        )),
                    ]);
                } catch (error) {
                    if (error?.message === "RUNTIME_MODULE_UNAVAILABLE") {
                        return {
                            status: "RUNTIME_MODULE_UNAVAILABLE",
                            moduleName: error.moduleName,
                            failureStage: error.failureStage ?? failureStage ?? "MODULE_RESOLVE",
                            moduleDiagnostics,
                            billingDiagnostics,
                            pageContext: pageContext(),
                        };
                    }
                    const errorMessage = error?.message
                        ?? error?.errors?.[0]?.message
                        ?? error?.source?.errors?.[0]?.message
                        ?? null;
                    return {
                        status: "ERROR",
                        failureStage,
                        errorMessage: errorMessage ? String(errorMessage) : null,
                        contextDiagnostics: error?.message?.startsWith("BILLING_FRAGMENT_")
                            ? {
                                fragmentSelectorAvailable: Boolean(error.fragmentSelectorAvailable),
                                fragmentDataAvailable: Boolean(error.fragmentDataAvailable),
                                fragmentMissingData: Boolean(error.fragmentMissingData),
                            }
                            : null,
                        moduleDiagnostics,
                        billingDiagnostics,
                        pageContext: pageContext(),
                    };
                }
            },
            {
                accountId: normalizedPaymentAccountId,
                pan: normalizedCardNumber,
                cvv: normalizedSecurityCode,
                cardExpiration: normalizedExpiration,
                name: normalizedCardholderName,
                zip: normalizedPostalCode,
                country: normalizedCountryCode,
                email: normalizeOptionalString(cardholderEmail),
                phone: normalizeOptionalString(cardholderPhoneNumber),
                sharability: normalizeOptionalString(credentialSharability),
                shouldSetDefault: Boolean(setDefault),
                recurringConsent: Boolean(recurringPaymentConsentGiven),
                tokenizationConsent: Boolean(networkTokenizationConsentGiven),
                billingBusinessId: normalizedBusinessId,
                timeoutMs: normalizeTimeout(timeout),
            }
        );

        const status = runtimeResult?.status;
        if (status === "ADDED") {
            return createResult(true, addCreditCardPaymentMethodStatuses.ADDED, {
                paymentMethodId: runtimeResult.paymentMethodId,
                network: runtimeResult.network,
                last4: runtimeResult.last4,
            });
        }
        if (status === "AUTHENTICATION_REQUIRED") {
            return createResult(false, addCreditCardPaymentMethodStatuses.AUTHENTICATION_REQUIRED, {
                paymentMethodId: runtimeResult.paymentMethodId ?? null,
                verification: runtimeResult.verification ?? null,
            });
        }
        if (status === "REQUIRES_RISK_VERIFICATION") {
            return createResult(false, addCreditCardPaymentMethodStatuses.REQUIRES_RISK_VERIFICATION, {
                paymentMethodId: runtimeResult.paymentMethodId ?? null,
                riskVerification: runtimeResult.riskVerification ?? null,
            });
        }
        if (status === "RISK_CHECK_FAILED") {
            return createResult(false, addCreditCardPaymentMethodStatuses.RISK_CHECK_FAILED, {
                paymentMethodId: runtimeResult.paymentMethodId ?? null,
            });
        }
        if (status === "PTT_GENERATION_FAILED") {
            return createResult(false, addCreditCardPaymentMethodStatuses.PTT_GENERATION_FAILED);
        }
        if (status === "CARD_SAVE_REJECTED") {
            return createResult(false, addCreditCardPaymentMethodStatuses.CARD_SAVE_REJECTED, {
                paymentMethodId: runtimeResult.paymentMethodId ?? null,
                verificationStatus: runtimeResult.verificationStatus ?? null,
            });
        }
        if (status === "RUNTIME_MODULE_UNAVAILABLE") {
            return createResult(false, addCreditCardPaymentMethodStatuses.RUNTIME_MODULE_UNAVAILABLE, null, {
                moduleName: runtimeResult.moduleName ?? null,
                failureStage: runtimeResult.failureStage ?? null,
                moduleDiagnostics: runtimeResult.moduleDiagnostics ?? [],
                pageContext: runtimeResult.pageContext ?? null,
                error: runtimeResult.moduleName
                    ? `Не вдалося завантажити модуль ${runtimeResult.moduleName}`
                    : "Не вдалося завантажити модуль Billing",
            });
        }
        if (status === "RUNTIME_CONTEXT_UNAVAILABLE") {
            return createResult(false, addCreditCardPaymentMethodStatuses.RUNTIME_CONTEXT_UNAVAILABLE, null, {
                failureStage: runtimeResult.failureStage ?? "BUILD_BILLING_CONTEXT_SNAPSHOTS",
                contextDiagnostics: runtimeResult.contextDiagnostics ?? null,
                billingDiagnostics: runtimeResult.billingDiagnostics ?? [],
                pageContext: runtimeResult.pageContext ?? null,
                error: "Billing-модулі завантажені, але Meta не повернула потрібний Billing-контекст",
            });
        }
        if (status === "REQUEST_TIMEOUT") {
            return createResult(false, addCreditCardPaymentMethodStatuses.REQUEST_TIMEOUT, null, {
                error: "Час очікування вичерпано; не повторюйте запит автоматично, доки не перевірите Billing Hub",
            });
        }

        if (isCardAccountLimitError(runtimeResult?.errorMessage)) {
            return createResult(
                false,
                addCreditCardPaymentMethodStatuses.CARD_ACCOUNT_LIMIT_REACHED,
                null,
                {
                    failureStage: runtimeResult?.failureStage ?? null,
                    error: "Неможливо додати карту: перевищено ліміт рекламних кабінетів для цієї карти. Видаліть її з іншого РК або використайте іншу карту.",
                }
            );
        }

        return createResult(false, addCreditCardPaymentMethodStatuses.ERROR, null, {
            failureStage: runtimeResult?.failureStage ?? null,
            moduleDiagnostics: runtimeResult?.moduleDiagnostics ?? [],
            billingDiagnostics: runtimeResult?.billingDiagnostics ?? [],
            contextDiagnostics: runtimeResult?.contextDiagnostics ?? null,
            pageContext: runtimeResult?.pageContext ?? null,
            error: runtimeResult?.errorMessage
                || "Не вдалося додати платіжну карту через Billing Hub",
        });
    } catch {
        return createResult(false, addCreditCardPaymentMethodStatuses.ERROR, null, {
            error: "Не вдалося виконати action додавання платіжної карти",
        });
    }
}
