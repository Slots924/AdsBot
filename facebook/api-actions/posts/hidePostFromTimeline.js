import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const hidePostFriendlyName = "CometFeedStoryExecuteNFXActionMutation";
const hidePostDocId = "39997318626533845";


export const hidePostFromTimelineStatuses = Object.freeze({
    HIDDEN: "HIDDEN",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує context конкретного story без журналювання його тимчасових token-полів.
function normalizeContext(context) {
    if (typeof context === "string" && context.trim()) {
        try {
            JSON.parse(context);
            return context;
        } catch {
            return null;
        }
    }

    if (!context || typeof context !== "object" || Array.isArray(context)) {
        return null;
    }

    return JSON.stringify(context);
}


// Приховує конкретний story з таймлайна поточного Facebook-профілю.
export default async function hidePostFromTimeline({
    page,
    commonPayload,
    context,
    clientMutationId,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedContext = normalizeContext(context);
    const normalizedClientMutationId = String(clientMutationId ?? "").trim();

    if (
        validationError
        || missingRequestField
        || !normalizedContext
        || !normalizedClientMutationId
    ) {
        return createResult(false, hidePostFromTimelineStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : (!normalizedContext
                        ? "Потрібен коректний JSON context конкретного story"
                        : "Потрібен clientMutationId поточного workflow")),
        });
    }

    try {
        const profileId = String(commonPayload.__user);
        const normalizedTimeout = normalizeTimeout(timeout);
        const body = buildMutationBody(commonPayload, {
            friendlyName: hidePostFriendlyName,
            docId: hidePostDocId,
            variables: {
                input: {
                    context: normalizedContext,
                    type: "HIDE_FROM_TIMELINE",
                    actor_id: profileId,
                    client_mutation_id: normalizedClientMutationId,
                },
                scale: 1,
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
            friendlyName: hidePostFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, hidePostFromTimelineStatuses.REQUEST_TIMEOUT, null, {
                stage: "HIDE",
            });
        }
        if (response.requestError) {
            return createResult(false, hidePostFromTimelineStatuses.REQUEST_FAILED, null, {
                stage: "HIDE",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, hidePostFromTimelineStatuses.HTTP_ERROR, null, {
                stage: "HIDE",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, hidePostFromTimelineStatuses.PARSE_ERROR, null, {
                stage: "HIDE",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, hidePostFromTimelineStatuses.GRAPHQL_ERROR, data, {
                stage: "HIDE",
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, hidePostFromTimelineStatuses.HIDDEN, null, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, hidePostFromTimelineStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
