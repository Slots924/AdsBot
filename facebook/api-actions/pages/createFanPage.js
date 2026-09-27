import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const createFanPageFriendlyName = "AdditionalProfilePlusCreationMutation";
const createFanPageDocId = "23863457623296585";
const defaultCategoryId = "802560142464893";
const pageReferrer = "profile_switcher_unified_creation";


export const createFanPageStatuses = Object.freeze({
    CREATED: "CREATED",
    CREATION_REJECTED: "CREATION_REJECTED",
    CREATION_RESULT_NOT_FOUND: "CREATION_RESULT_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Створює додатковий Facebook-профіль Plus і пов'язану з ним сторінку.
export default async function createFanPage({
    page,
    commonPayload,
    name,
    categoryId = defaultCategoryId,
    bio = "",
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedName = String(name ?? "").trim();
    const normalizedCategoryId = String(categoryId ?? "").trim();

    if (validationError || missingRequestField || !normalizedName || !normalizedCategoryId
        || typeof bio !== "string") {
        return createResult(false, createFanPageStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : (!normalizedName
                        ? "Потрібна непорожня назва сторінки"
                        : (!normalizedCategoryId
                            ? "Потрібен categoryId"
                            : "bio має бути рядком"))),
        });
    }

    try {
        const variables = {
            input: {
                bio,
                categories: [normalizedCategoryId],
                creation_source: "comet",
                name: normalizedName,
                off_platform_creator_reachout_id: null,
                page_referrer: pageReferrer,
                actor_id: String(commonPayload.__user),
                client_mutation_id: "1",
            },
        };
        const body = buildMutationBody(commonPayload, {
            friendlyName: createFanPageFriendlyName,
            docId: createFanPageDocId,
            variables,
            extraParameters: {
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: createFanPageFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, createFanPageStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, createFanPageStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, createFanPageStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, createFanPageStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, createFanPageStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        const creation = data?.data?.additional_profile_plus_create;
        const errorMessage = creation?.error_message ?? creation?.name_error ?? null;
        if (errorMessage) {
            return createResult(false, createFanPageStatuses.CREATION_REJECTED, data, {
                error: String(errorMessage),
                httpStatus: response.statusCode,
            });
        }

        const pageId = creation?.page?.id ?? null;
        const additionalProfileId = creation?.additional_profile?.id ?? null;
        if (!pageId) {
            return createResult(false, createFanPageStatuses.CREATION_RESULT_NOT_FOUND, data, {
                error: "Facebook не повернув ID створеної сторінки",
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, createFanPageStatuses.CREATED, data, {
            pageId: String(pageId),
            additionalProfileId: additionalProfileId ? String(additionalProfileId) : null,
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, createFanPageStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
