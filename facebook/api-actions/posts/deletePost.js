import { readFacebookRuntime } from "../../api/runtime.js";
import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../../api/browserRequest.js";


const deletePostFriendlyName = "useCometTrashPostMutation";
const deletePostDocId = "26146132388368957";


export const deletePostStatuses = Object.freeze({
    DELETED: "DELETED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Переміщує існуючий пост поточного Facebook-профілю до кошика за його GraphQL story ID.
export default async function deletePost({
    page,
    storyId,
    clientMutationId,
    qplActiveFlowIds = null,
    timeout,
}) {
    const runtimeContext = await readFacebookRuntime(page, { surface: "facebook", timeout });
    const validationError = validateMutationInput(page, runtimeContext);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t"]
        .find((field) => runtimeContext?.[field] === undefined || runtimeContext[field] === null);
    const normalizedStoryId = String(storyId ?? "").trim();
    const normalizedClientMutationId = String(clientMutationId ?? "").trim();
    const normalizedQplActiveFlowIds = String(
        qplActiveFlowIds ?? runtimeContext?.qpl_active_flow_ids ?? ""
    ).trim();

    if (
        validationError
        || missingRequestField
        || !normalizedStoryId
        || !normalizedClientMutationId
    ) {
        return createResult(false, deletePostStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У runtimeContext відсутнє поле ${missingRequestField}`
                    : (!normalizedStoryId
                        ? "Потрібен GraphQL storyId поста"
                        : "Потрібен clientMutationId поточного workflow")),
        });
    }

    try {
        const profileId = String(runtimeContext.av);
        const normalizedTimeout = normalizeTimeout(timeout);
        const extraParameters = {
            __spin_r: runtimeContext.__spin_r,
            __spin_b: runtimeContext.__spin_b,
            __spin_t: runtimeContext.__spin_t,
            __crn: runtimeContext.__crn,
        };
        if (normalizedQplActiveFlowIds) {
            extraParameters.qpl_active_flow_ids = normalizedQplActiveFlowIds;
            extraParameters.fb_api_analytics_tags = JSON.stringify([
                `qpl_active_flow_ids=${normalizedQplActiveFlowIds}`,
            ]);
        }

        const body = buildMutationBody(runtimeContext, {
            friendlyName: deletePostFriendlyName,
            docId: deletePostDocId,
            variables: {
                input: {
                    story_id: normalizedStoryId,
                    story_location: "TIMELINE",
                    actor_id: profileId,
                    client_mutation_id: normalizedClientMutationId,
                },
            },
            extraParameters,
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: deletePostFriendlyName,
            timeout: normalizedTimeout,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, deletePostStatuses.REQUEST_TIMEOUT, null, {
                stage: "DELETE",
            });
        }
        if (response.requestError) {
            return createResult(false, deletePostStatuses.REQUEST_FAILED, null, {
                stage: "DELETE",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, deletePostStatuses.HTTP_ERROR, null, {
                stage: "DELETE",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, deletePostStatuses.PARSE_ERROR, null, {
                stage: "DELETE",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, deletePostStatuses.GRAPHQL_ERROR, data, {
                stage: "DELETE",
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, deletePostStatuses.DELETED, {
            storyId: normalizedStoryId,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, deletePostStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
