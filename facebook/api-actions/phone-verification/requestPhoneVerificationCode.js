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
const whatsappMethod = "WHATSAPP_MESSAGE";

const enterPhoneScreenType = "BVWizardAdvertiserVerificationEnterPhoneIXTScreenViewModel";
const selectMethodScreenType = "ChallengeSelectIXTScreenViewModel";
const confirmSmsScreenType = "ChallengeSMSConfirmIXTScreenViewModel";
const enterSmsCodeScreenType = "ChallengeSMSEnterCodeIXTScreenViewModel";
const confirmWhatsappScreenType = "ChallengeWhatsAppConfirmIXTScreenViewModel";
const enterWhatsappCodeScreenType = "ChallengeWhatsAppEnterCodeIXTScreenViewModel";

const deliveryMethods = Object.freeze({
    [smsMethod]: {
        confirmScreenType: confirmSmsScreenType,
        enterCodeScreenType: enterSmsCodeScreenType,
        confirmInputName: "challenge_sms_confirm",
        getConfirmScreen: (viewModel) => viewModel?.bv_wizard_challenge_sms_confirm_screen ?? null,
        getEnterCodeScreen: (viewModel) => viewModel?.bv_wizard_challenge_sms_enter_code_screen ?? null,
        sentStatus: "SMS_CODE_SENT",
    },
    [whatsappMethod]: {
        confirmScreenType: confirmWhatsappScreenType,
        enterCodeScreenType: enterWhatsappCodeScreenType,
        confirmInputName: "challenge_whatsapp_confirm",
        getConfirmScreen: (viewModel) => viewModel?.challenge_whatsapp_confirm_screen_content_renderer
            ?.bv_wizard_challenge_whatsapp_confirm_screen
            ?? viewModel?.bv_wizard_challenge_whatsapp_confirm_screen
            ?? null,
        getEnterCodeScreen: (viewModel) => viewModel?.challenge_whatsapp_enter_code_screen_content_renderer
            ?.bv_wizard_challenge_whatsapp_enter_code_screen
            ?? viewModel?.bv_wizard_challenge_whatsapp_enter_code_screen
            ?? null,
        sentStatus: "WHATSAPP_CODE_SENT",
    },
});


export const requestPhoneVerificationCodeStatuses = Object.freeze({
    SMS_CODE_SENT: "SMS_CODE_SENT",
    WHATSAPP_CODE_SENT: "WHATSAPP_CODE_SENT",
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


function getChallengeSelectScreen(viewModel) {
    return viewModel?.challenge_select_screen_content_renderer
        ?.bv_wizard_challenge_select_screen
        ?? viewModel?.bv_wizard_challenge_select_screen
        ?? null;
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
    const validationError = validateMutationInput(page, commonPayload, { requireAv: false });
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedAdAccountId = String(adAccountId ?? "").trim();
    const normalizedPhone = String(phoneE164 ?? "").trim();
    const normalizedCountryCode = String(countryCode ?? "").trim().toUpperCase();
    const normalizedLocale = String(locale ?? "").trim();
    const normalizedMethod = String(method ?? "").trim().toUpperCase();
    const normalizedTriggerSessionId = String(triggerSessionId ?? "").trim();
    const methodConfig = deliveryMethods[normalizedMethod] ?? null;

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

    if (!methodConfig) {
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

        const challengeSelectScreen = getChallengeSelectScreen(selectMethodScreen.viewModel);
        const availableMethods = challengeSelectScreen?.challenge_method_options ?? [];
        if (!availableMethods.includes(normalizedMethod)) {
            return createResult(false, requestPhoneVerificationCodeStatuses.METHOD_UNAVAILABLE, {
                flow: createFlow({
                    adAccountId: normalizedAdAccountId,
                    method: normalizedMethod,
                    phoneE164: normalizedPhone,
                    phoneDisplay: challengeSelectScreen?.phone_number ?? null,
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

        const selectMethodResult = await executeStep({
            page,
            commonPayload,
            adAccountId: normalizedAdAccountId,
            friendlyName: nextFriendlyName,
            docId: nextDocId,
            variables: {
                input: {
                    challenge_select: {
                        selected_challenge_method: normalizedMethod,
                        serialized_state: selectMethodScreen.serializedState,
                    },
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: "2",
                },
                scale: 1,
            },
            timeout: normalizedTimeout,
            stage: `SELECT_${normalizedMethod}`,
        });
        if (selectMethodResult.errorStatus) {
            return createResult(false, selectMethodResult.errorStatus, selectMethodResult.data ?? null, selectMethodResult);
        }

        const confirmScreen = parseNextScreen(selectMethodResult.data);
        const phoneDisplay = methodConfig.getConfirmScreen(confirmScreen.viewModel)?.phone_number ?? null;
        if (confirmScreen.screenType !== methodConfig.confirmScreenType
            || !confirmScreen.serializedState || !phoneDisplay) {
            return createResult(false, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN, selectMethodResult.data, {
                stage: `SELECT_${normalizedMethod}`,
                expectedScreenType: methodConfig.confirmScreenType,
                actualScreenType: confirmScreen.screenType,
                httpStatus: selectMethodResult.httpStatus,
            });
        }

        const sendCodeResult = await executeStep({
            page,
            commonPayload,
            adAccountId: normalizedAdAccountId,
            friendlyName: nextFriendlyName,
            docId: nextDocId,
            variables: {
                input: {
                    [methodConfig.confirmInputName]: {
                        phone_number: phoneDisplay,
                        serialized_state: confirmScreen.serializedState,
                    },
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: "3",
                },
                scale: 1,
            },
            timeout: normalizedTimeout,
            stage: `SEND_${normalizedMethod}`,
        });
        if (sendCodeResult.errorStatus) {
            return createResult(false, sendCodeResult.errorStatus, sendCodeResult.data ?? null, sendCodeResult);
        }

        const enterCodeScreen = parseNextScreen(sendCodeResult.data);
        if (enterCodeScreen.screenType !== methodConfig.enterCodeScreenType || !enterCodeScreen.serializedState) {
            return createResult(false, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN, sendCodeResult.data, {
                stage: `SEND_${normalizedMethod}`,
                expectedScreenType: methodConfig.enterCodeScreenType,
                actualScreenType: enterCodeScreen.screenType,
                httpStatus: sendCodeResult.httpStatus,
            });
        }

        return createResult(true, requestPhoneVerificationCodeStatuses[methodConfig.sentStatus], {
            flow: createFlow({
                adAccountId: normalizedAdAccountId,
                method: normalizedMethod,
                phoneE164: normalizedPhone,
                phoneDisplay: methodConfig.getEnterCodeScreen(enterCodeScreen.viewModel)?.phone_number ?? phoneDisplay,
                countryCode: normalizedCountryCode,
                locale: normalizedLocale,
                screen: enterCodeScreen,
                triggerSessionId: normalizedTriggerSessionId,
            }),
            response: sendCodeResult.data,
        }, {
            httpStatus: sendCodeResult.httpStatus,
        });
    } catch (error) {
        return createResult(false, requestPhoneVerificationCodeStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
