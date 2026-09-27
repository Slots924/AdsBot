import { randomUUID } from "node:crypto";

import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const triggerFriendlyName = "CometIXTFacebookXfacBvTriggerRootQuery";
const triggerDocId = "28631875969757608";
const nextFriendlyName = "CometFacebookIXTNextMutation";
const nextDocId = "29061690550105326";
const smsMethod = "SMS";

const enterPhoneScreenType = "BVWizardAdvertiserVerificationEnterPhoneIXTScreenViewModel";
const selectMethodScreenType = "ChallengeSelectIXTScreenViewModel";
const confirmSmsScreenType = "ChallengeSMSConfirmIXTScreenViewModel";
const enterSmsCodeScreenType = "ChallengeSMSEnterCodeIXTScreenViewModel";


export const requestPhoneVerificationCodeStatuses = Object.freeze({
    SMS_CODE_SENT: "SMS_CODE_SENT",
    METHOD_UNAVAILABLE: "METHOD_UNAVAILABLE",
    METHOD_NOT_IMPLEMENTED: "METHOD_NOT_IMPLEMENTED",
    UNEXPECTED_SCREEN: "UNEXPECTED_SCREEN",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Витягує view model з response стартового запиту verification flow.
function parseRootScreen(data) {
    const screen = data?.data?.ixt_xfac_bv_trigger?.screen ?? null;
    const viewModel = screen?.view_model ?? null;

    return {
        displayType: screen?.display_type ?? null,
        screenType: viewModel?.__typename ?? null,
        serializedState: viewModel?.serialized_state ?? null,
        submissionId: viewModel?.submission_id ?? null,
        viewModel,
    };
}


// Витягує view model з response наступного кроку verification flow.
function parseNextScreen(data) {
    const next = data?.data?.ixt_screen_next ?? null;
    const viewModel = next?.view_model ?? null;

    return {
        displayType: next?.display_type ?? null,
        screenType: viewModel?.__typename ?? null,
        serializedState: viewModel?.serialized_state ?? null,
        submissionId: viewModel?.submission_id ?? null,
        viewModel,
    };
}


// Виконує один GraphQL-крок і повертає розібраний або сирий response.
async function executeStep({
    page,
    commonPayload,
    adAccountId,
    friendlyName,
    docId,
    variables,
    timeout,
    stage,
}) {
    const body = buildMutationBody(commonPayload, {
        friendlyName,
        docId,
        variables,
        extraParameters: {
            __aaid: adAccountId,
            __spin_r: commonPayload.__spin_r,
            __spin_b: commonPayload.__spin_b,
            __spin_t: commonPayload.__spin_t,
            __crn: commonPayload.__crn,
        },
    });
    const response = await postFacebookForm(page, {
        body,
        friendlyName,
        lsd: commonPayload.lsd,
        timeout,
    });

    if (response.requestError === "TIMEOUT") {
        return { errorStatus: requestPhoneVerificationCodeStatuses.REQUEST_TIMEOUT, stage };
    }
    if (response.requestError) {
        return {
            errorStatus: requestPhoneVerificationCodeStatuses.REQUEST_FAILED,
            stage,
            error: response.requestError,
        };
    }
    if (!response.ok) {
        return {
            errorStatus: requestPhoneVerificationCodeStatuses.HTTP_ERROR,
            stage,
            httpStatus: response.statusCode,
        };
    }

    try {
        const data = parseFacebookJson(response.body);
        if (hasGraphqlErrors(data)) {
            return {
                errorStatus: requestPhoneVerificationCodeStatuses.GRAPHQL_ERROR,
                stage,
                data,
                httpStatus: response.statusCode,
            };
        }

        return { data, httpStatus: response.statusCode };
    } catch (error) {
        return {
            errorStatus: requestPhoneVerificationCodeStatuses.PARSE_ERROR,
            stage,
            error: String(error?.message ?? error),
            httpStatus: response.statusCode,
        };
    }
}


// Створює flow-об'єкт, який потрібно передати в submitPhoneVerificationCode.
function createFlow({
    adAccountId,
    method,
    phoneE164,
    phoneDisplay,
    countryCode,
    locale,
    screen,
    triggerSessionId,
}) {
    return {
        adAccountId,
        method,
        phoneE164,
        phoneDisplay,
        countryCode,
        locale,
        serializedState: screen.serializedState,
        submissionId: screen.submissionId,
        currentScreenType: screen.screenType,
        triggerSessionId,
    };
}


// Запускає verification flow, вводить номер, обирає SMS і надсилає код.
// Для WHATSAPP_MESSAGE та ROBOCALL зараз повертається METHOD_NOT_IMPLEMENTED без mutation.
export default async function requestPhoneVerificationCode({
    page,
    commonPayload,
    adAccountId,
    phoneE164,
    countryCode,
    locale,
    method = smsMethod,
    triggerSessionId = randomUUID(),
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedAdAccountId = String(adAccountId ?? "").trim();
    const normalizedPhone = String(phoneE164 ?? "").trim();
    const normalizedCountryCode = String(countryCode ?? "").trim().toUpperCase();
    const normalizedLocale = String(locale ?? "").trim();
    const normalizedMethod = String(method ?? "").trim().toUpperCase();
    const normalizedTriggerSessionId = String(triggerSessionId ?? "").trim();

    if (validationError || missingRequestField || !normalizedAdAccountId
        || !/^\+[1-9]\d{6,14}$/.test(normalizedPhone)
        || !/^[A-Z]{2}$/.test(normalizedCountryCode) || !normalizedLocale
        || !normalizedTriggerSessionId) {
        return createResult(false, requestPhoneVerificationCodeStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібні adAccountId, телефон E.164, дволітерний countryCode, locale і triggerSessionId"),
        });
    }

    if (normalizedMethod !== smsMethod) {
        return createResult(false, requestPhoneVerificationCodeStatuses.METHOD_NOT_IMPLEMENTED, null, {
            error: `Метод ${normalizedMethod} ще не реалізований`,
            method: normalizedMethod,
        });
    }

    try {
        const normalizedTimeout = normalizeTimeout(timeout);
        const rootResult = await executeStep({
            page,
            commonPayload,
            adAccountId: normalizedAdAccountId,
            friendlyName: triggerFriendlyName,
            docId: triggerDocId,
            variables: {
                input: {
                    authenticatable_entity_id: normalizedAdAccountId,
                    bap_product: "ADVERTISER_VETTING",
                    business_verification_design_system: "GEODESIC",
                    business_verification_ui_type: "ADS_MANAGER_ACCOUNT_OVERVIEW_SYD",
                    config_type: "PHONE_VERIFICATION",
                    trigger_event_type: "XFAC_BV_ADS_MANAGER_ENTRY",
                    xfac_config: "XFAC_BUSINESS_VERIFICATION_ADVERTISER_VETTING",
                    xfac_appeal_type: "BUSINESS_VERIFICATION_ADVERTISER_VETTING",
                    nt_context: null,
                    trigger_session_id: normalizedTriggerSessionId,
                },
                scale: 1,
            },
            timeout: normalizedTimeout,
            stage: "START_FLOW",
        });
        if (rootResult.errorStatus) {
            return createResult(false, rootResult.errorStatus, rootResult.data ?? null, rootResult);
        }

        const enterPhoneScreen = parseRootScreen(rootResult.data);
        if (enterPhoneScreen.screenType !== enterPhoneScreenType || !enterPhoneScreen.serializedState) {
            return createResult(false, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN, rootResult.data, {
                stage: "START_FLOW",
                expectedScreenType: enterPhoneScreenType,
                actualScreenType: enterPhoneScreen.screenType,
                httpStatus: rootResult.httpStatus,
            });
        }

        const enterPhoneResult = await executeStep({
            page,
            commonPayload,
            adAccountId: normalizedAdAccountId,
            friendlyName: nextFriendlyName,
            docId: nextDocId,
            variables: {
                input: {
                    bv_wizard_advertiser_verification_enter_phone: {
                        country_code: normalizedCountryCode,
                        locale: normalizedLocale,
                        phone_number: normalizedPhone,
                        serialized_state: enterPhoneScreen.serializedState,
                    },
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: "1",
                },
                scale: 1,
            },
            timeout: normalizedTimeout,
            stage: "ENTER_PHONE",
        });
        if (enterPhoneResult.errorStatus) {
            return createResult(false, enterPhoneResult.errorStatus, enterPhoneResult.data ?? null, enterPhoneResult);
        }

        const selectMethodScreen = parseNextScreen(enterPhoneResult.data);
        if (selectMethodScreen.screenType !== selectMethodScreenType || !selectMethodScreen.serializedState) {
            return createResult(false, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN, enterPhoneResult.data, {
                stage: "ENTER_PHONE",
                expectedScreenType: selectMethodScreenType,
                actualScreenType: selectMethodScreen.screenType,
                httpStatus: enterPhoneResult.httpStatus,
            });
        }

        const availableMethods = selectMethodScreen.viewModel
            ?.bv_wizard_challenge_select_screen?.challenge_method_options ?? [];
        if (!availableMethods.includes(smsMethod)) {
            return createResult(false, requestPhoneVerificationCodeStatuses.METHOD_UNAVAILABLE, {
                flow: createFlow({
                    adAccountId: normalizedAdAccountId,
                    method: smsMethod,
                    phoneE164: normalizedPhone,
                    phoneDisplay: selectMethodScreen.viewModel?.phone_number ?? null,
                    countryCode: normalizedCountryCode,
                    locale: normalizedLocale,
                    screen: selectMethodScreen,
                    triggerSessionId: normalizedTriggerSessionId,
                }),
                response: enterPhoneResult.data,
            }, {
                availableMethods,
                stage: "SELECT_METHOD",
                httpStatus: enterPhoneResult.httpStatus,
            });
        }

        const selectSmsResult = await executeStep({
            page,
            commonPayload,
            adAccountId: normalizedAdAccountId,
            friendlyName: nextFriendlyName,
            docId: nextDocId,
            variables: {
                input: {
                    challenge_select: {
                        selected_challenge_method: smsMethod,
                        serialized_state: selectMethodScreen.serializedState,
                    },
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: "2",
                },
                scale: 1,
            },
            timeout: normalizedTimeout,
            stage: "SELECT_SMS",
        });
        if (selectSmsResult.errorStatus) {
            return createResult(false, selectSmsResult.errorStatus, selectSmsResult.data ?? null, selectSmsResult);
        }

        const confirmSmsScreen = parseNextScreen(selectSmsResult.data);
        const phoneDisplay = confirmSmsScreen.viewModel
            ?.bv_wizard_challenge_sms_confirm_screen?.phone_number ?? null;
        if (confirmSmsScreen.screenType !== confirmSmsScreenType
            || !confirmSmsScreen.serializedState || !phoneDisplay) {
            return createResult(false, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN, selectSmsResult.data, {
                stage: "SELECT_SMS",
                expectedScreenType: confirmSmsScreenType,
                actualScreenType: confirmSmsScreen.screenType,
                httpStatus: selectSmsResult.httpStatus,
            });
        }

        const sendSmsResult = await executeStep({
            page,
            commonPayload,
            adAccountId: normalizedAdAccountId,
            friendlyName: nextFriendlyName,
            docId: nextDocId,
            variables: {
                input: {
                    challenge_sms_confirm: {
                        phone_number: phoneDisplay,
                        serialized_state: confirmSmsScreen.serializedState,
                    },
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: "3",
                },
                scale: 1,
            },
            timeout: normalizedTimeout,
            stage: "SEND_SMS",
        });
        if (sendSmsResult.errorStatus) {
            return createResult(false, sendSmsResult.errorStatus, sendSmsResult.data ?? null, sendSmsResult);
        }

        const enterCodeScreen = parseNextScreen(sendSmsResult.data);
        if (enterCodeScreen.screenType !== enterSmsCodeScreenType || !enterCodeScreen.serializedState) {
            return createResult(false, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN, sendSmsResult.data, {
                stage: "SEND_SMS",
                expectedScreenType: enterSmsCodeScreenType,
                actualScreenType: enterCodeScreen.screenType,
                httpStatus: sendSmsResult.httpStatus,
            });
        }

        return createResult(true, requestPhoneVerificationCodeStatuses.SMS_CODE_SENT, {
            flow: createFlow({
                adAccountId: normalizedAdAccountId,
                method: smsMethod,
                phoneE164: normalizedPhone,
                phoneDisplay: enterCodeScreen.viewModel
                    ?.bv_wizard_challenge_sms_enter_code_screen?.phone_number ?? phoneDisplay,
                countryCode: normalizedCountryCode,
                locale: normalizedLocale,
                screen: enterCodeScreen,
                triggerSessionId: normalizedTriggerSessionId,
            }),
            response: sendSmsResult.data,
        }, {
            httpStatus: sendSmsResult.httpStatus,
        });
    } catch (error) {
        return createResult(false, requestPhoneVerificationCodeStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
