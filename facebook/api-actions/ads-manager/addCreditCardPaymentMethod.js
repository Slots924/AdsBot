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
    PTT_GENERATION_FAILED: "PTT_GENERATION_FAILED",
    RISK_CHECK_FAILED: "RISK_CHECK_FAILED",
    RUNTIME_MODULE_UNAVAILABLE: "RUNTIME_MODULE_UNAVAILABLE",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    ERROR: "ERROR",
});


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
        || !normalizedCardholderName || !normalizedPostalCode
        || !/^[A-Z]{2}$/.test(normalizedCountryCode)) {
        return createResult(false, addCreditCardPaymentMethodStatuses.INVALID_INPUT, null, {
            error: "Потрібні paymentAccountId, номер карти, CVV, expiration у форматі MM/YY, ім'я, ZIP і countryCode",
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
                    "BillingContextUtils",
                    "BillingWizardGKConfig",
                    "BillingWizardQEConfig",
                    "BillingGKLogExposure",
                    "BillingQELogExposure",
                    "BillingCreditCardUtils",
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
                    for (const moduleName of runtimeModuleNames) loadModule(moduleName);

                    const environment = loadModule("RelayFBEnvironment");
                    const buildCommitMutation = loadModule("BillingBuildCommitMutation");
                    const buildFetchQuery = loadModule("BillingBuildFetchQuery");
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
                    const contextResponse = await fetchRelayOnce(
                        environment,
                        billingContextFactory.BillingContextFactoryQuery,
                        {
                            hasInitCheckBusinessIds: hasBusinessId,
                            hasPaymentAccount: true,
                            initCheckBusinessIds: hasBusinessId ? [billingBusinessId] : [],
                            paymentAccountID: accountId,
                        }
                    );
                    const gkSnapshot = billingContextFactory
                        .buildInitCheckGKSnapshotFromResponse(contextResponse);
                    const qeSnapshot = billingContextFactory
                        .buildInitCheckQESnapshotFromResponse(contextResponse);

                    if (!gkSnapshot || !qeSnapshot) {
                        return { status: "RUNTIME_CONTEXT_UNAVAILABLE" };
                    }

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

                    const cardUtils = loadModule("BillingCreditCardUtils");
                    const protectedString = loadModule("BillingProtectedString");
                    const pttUtils = loadModule("BillingPTTUtils");
                    pttUtils.init();

                    const card = {
                        cardHolderEmail: email,
                        cardHolderPhoneNumber: phone,
                        cardNumber: cardUtils.formatCardNumber(pan),
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
                        };
                    }
                    return { status: "ERROR" };
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
        if (status === "RUNTIME_MODULE_UNAVAILABLE" || status === "RUNTIME_CONTEXT_UNAVAILABLE") {
            return createResult(false, addCreditCardPaymentMethodStatuses.RUNTIME_MODULE_UNAVAILABLE, null, {
                moduleName: runtimeResult.moduleName ?? null,
            });
        }
        if (status === "REQUEST_TIMEOUT") {
            return createResult(false, addCreditCardPaymentMethodStatuses.REQUEST_TIMEOUT, null, {
                error: "Час очікування вичерпано; не повторюйте запит автоматично, доки не перевірите Billing Hub",
            });
        }

        return createResult(false, addCreditCardPaymentMethodStatuses.ERROR, null, {
            error: "Не вдалося додати платіжну карту через Billing Hub",
        });
    } catch {
        return createResult(false, addCreditCardPaymentMethodStatuses.ERROR, null, {
            error: "Не вдалося виконати action додавання платіжної карти",
        });
    }
}
