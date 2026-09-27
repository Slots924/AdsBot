import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const profileSwitchFriendlyName = "CometProfileSwitchMutation";
const profileSwitchDocId = "29569331136046912";


export const switchToAdditionalProfileStatuses = Object.freeze({
    SWITCH_REQUEST_ACCEPTED: "SWITCH_REQUEST_ACCEPTED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Перемикає активний Facebook-контекст на additional profile за його ID.
// additionalProfileId — це additional_profile.id з createFanPage, а не page.id фанпейджа.
// Після успішного виклику потрібно ОКРЕМО отримати новий commonPayload через
// captureGraphqlPayload: поточний payload належить основному профілю й більше неактуальний.
export default async function switchToAdditionalProfile({
    page,
    commonPayload,
    additionalProfileId,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedAdditionalProfileId = String(additionalProfileId ?? "").trim();

    if (validationError || missingRequestField || !normalizedAdditionalProfileId) {
        return createResult(false, switchToAdditionalProfileStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібен additionalProfileId, а не pageId фанпейджа"),
        });
    }

    try {
        const body = buildMutationBody(commonPayload, {
            friendlyName: profileSwitchFriendlyName,
            docId: profileSwitchDocId,
            variables: {
                profile_id: normalizedAdditionalProfileId,
            },
            extraParameters: {
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: profileSwitchFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, switchToAdditionalProfileStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, switchToAdditionalProfileStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, switchToAdditionalProfileStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        // Facebook може завершити mutation успішно без response body.
        if (!String(response.body ?? "").trim()) {
            return createResult(true, switchToAdditionalProfileStatuses.SWITCH_REQUEST_ACCEPTED, null, {
                additionalProfileId: normalizedAdditionalProfileId,
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, switchToAdditionalProfileStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, switchToAdditionalProfileStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, switchToAdditionalProfileStatuses.SWITCH_REQUEST_ACCEPTED, data, {
            additionalProfileId: normalizedAdditionalProfileId,
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, switchToAdditionalProfileStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
