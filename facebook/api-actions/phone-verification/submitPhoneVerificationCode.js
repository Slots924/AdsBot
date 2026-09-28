import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const nextFriendlyName = "CometFacebookIXTNextMutation";
const nextDocId = "29061690550105326";
const phoneConsentScreenType = "XFBBVWizardAdvertiserVerificationAdsManagerPhoneConsentIXTScreenViewModel";


export const submitPhoneVerificationCodeStatuses = Object.freeze({
    PHONE_VERIFIED: "PHONE_VERIFIED",
    CODE_REJECTED: "CODE_REJECTED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Витягує наступний screen і canonical serialized_state після надсилання SMS-коду.
function parseNextScreen(data) {
    const next = data?.data?.ixt_screen_next ?? null;
    const viewModel = next?.view_model ?? null;

    return {
        screenType: viewModel?.__typename ?? null,
        serializedState: viewModel?.serialized_state ?? null,
        submissionId: viewModel?.submission_id ?? null,
    };
}


// Подає SMS-код у вже створений verification flow.
// Перехід на Phone Consent означає, що номер уже підтверджено для рекламного кабінету.
// Наступний consent-крок є окремою необов'язковою прив'язкою, а не частиною верифікації номера.
export default async function submitPhoneVerificationCode({
    page,
    commonPayload,
    flow,
    code,
    clientMutationId = "4",
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload, { requireAv: false });
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedAdAccountId = String(flow?.adAccountId ?? "").trim();
    const normalizedSerializedState = String(flow?.serializedState ?? "").trim();
    const normalizedCode = String(code ?? "").trim();
    const normalizedMutationId = String(clientMutationId ?? "").trim();

    if (validationError || missingRequestField || !normalizedAdAccountId
        || !normalizedSerializedState || !/^\d{4,8}$/.test(normalizedCode)
        || !normalizedMutationId) {
        return createResult(false, submitPhoneVerificationCodeStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібні flow з adAccountId і serializedState, цифровий code та clientMutationId"),
        });
    }

    try {
        const body = buildMutationBody(commonPayload, {
            friendlyName: nextFriendlyName,
            docId: nextDocId,
            variables: {
                input: {
                    challenge_sms_enter_code: {
                        check_id: null,
                        code: normalizedCode,
                        serialized_state: normalizedSerializedState,
                    },
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: normalizedMutationId,
                },
                scale: 1,
            },
            extraParameters: {
                __aaid: normalizedAdAccountId,
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: nextFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, submitPhoneVerificationCodeStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, submitPhoneVerificationCodeStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, submitPhoneVerificationCodeStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, submitPhoneVerificationCodeStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, submitPhoneVerificationCodeStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        const screen = parseNextScreen(data);
        const nextFlow = {
            ...flow,
            serializedState: screen.serializedState,
            submissionId: screen.submissionId,
            currentScreenType: screen.screenType,
        };
        if (screen.screenType !== phoneConsentScreenType || !screen.serializedState) {
            return createResult(false, submitPhoneVerificationCodeStatuses.CODE_REJECTED, {
                flow: nextFlow,
                response: data,
            }, {
                expectedScreenType: phoneConsentScreenType,
                actualScreenType: screen.screenType,
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, submitPhoneVerificationCodeStatuses.PHONE_VERIFIED, {
            flow: nextFlow,
            response: data,
        }, {
            phoneVerified: true,
            optionalConsentRequired: true,
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, submitPhoneVerificationCodeStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
