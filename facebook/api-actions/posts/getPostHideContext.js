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


const menuFriendlyName = "CometFeedStoryMenuQuery";
const menuDocId = "28258200300469630";


export const getPostHideContextStatuses = Object.freeze({
    HIDE_CONTEXT_FOUND: "HIDE_CONTEXT_FOUND",
    HIDE_CONTEXT_NOT_FOUND: "HIDE_CONTEXT_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


function findHideAction(items) {
    return items.find((item) => item?.__typename === "StoryNFXActionMenuItem"
        && item?.action?.type === "HIDE_FROM_TIMELINE")?.action ?? null;
}


// Повертає свіжий hide-context конкретного story для наступного hidePostFromTimeline action.
export default async function getPostHideContext({
    page,
    storyId,
    timeout,
}) {
    const runtimeContext = await readFacebookRuntime(page, { surface: "facebook", timeout });
    const validationError = validateMutationInput(page, runtimeContext);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t"]
        .find((field) => runtimeContext?.[field] === undefined || runtimeContext[field] === null);
    const normalizedStoryId = String(storyId ?? "").trim();

    if (validationError || missingRequestField || !normalizedStoryId) {
        return createResult(false, getPostHideContextStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У runtimeContext відсутнє поле ${missingRequestField}`
                    : "Потрібен GraphQL storyId поста"),
        });
    }

    try {
        const normalizedTimeout = normalizeTimeout(timeout);
        const body = buildMutationBody(runtimeContext, {
            friendlyName: menuFriendlyName,
            docId: menuDocId,
            variables: {
                crosspostCallerName: "fx_product_foundation_client_FXOnline_client_cache",
                crosspostCustomPartnerParams: [
                    {
                        key: "CROSSPOSTING_DESTINATION_APP",
                        value: "IG",
                    },
                    {
                        key: "CROSSPOSTING_SHARE_TO_SURFACE",
                        value: "",
                    },
                    {
                        key: "SHOULD_RETURN_AUTO_XPOST_SETTING",
                        value: "true",
                    },
                ],
                crosspostServiceNames: ["CROSS_POSTING_SETTING"],
                feed_location: "TIMELINE",
                feed_menu_icon_variant: "FILLED",
                id: normalizedStoryId,
                renderLocation: "homepage_stream",
                scale: 1,
                serialized_frtp_identifiers: null,
                shouldFetchCrosspostMetadata: false,
                story_debug_info: null,
                __relay_internal__pv__CometFeedStoryCopyLinkMenuItem_isLinkSharingEnabledrelayprovider: true,
            },
            extraParameters: {
                __spin_r: runtimeContext.__spin_r,
                __spin_b: runtimeContext.__spin_b,
                __spin_t: runtimeContext.__spin_t,
                __crn: runtimeContext.__crn,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: menuFriendlyName,
            timeout: normalizedTimeout,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, getPostHideContextStatuses.REQUEST_TIMEOUT, null, {
                stage: "GET_HIDE_CONTEXT",
            });
        }
        if (response.requestError) {
            return createResult(false, getPostHideContextStatuses.REQUEST_FAILED, null, {
                stage: "GET_HIDE_CONTEXT",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, getPostHideContextStatuses.HTTP_ERROR, null, {
                stage: "GET_HIDE_CONTEXT",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, getPostHideContextStatuses.PARSE_ERROR, null, {
                stage: "GET_HIDE_CONTEXT",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, getPostHideContextStatuses.GRAPHQL_ERROR, data, {
                stage: "GET_HIDE_CONTEXT",
                httpStatus: response.statusCode,
            });
        }

        const items = data?.data?.feed_unit?.nfx_action_menu_items;
        const hideAction = findHideAction(Array.isArray(items) ? items : []);
        if (!hideAction?.context) {
            return createResult(true, getPostHideContextStatuses.HIDE_CONTEXT_NOT_FOUND, {
                storyId: normalizedStoryId,
                hideAvailable: false,
                context: null,
            }, {
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, getPostHideContextStatuses.HIDE_CONTEXT_FOUND, {
            storyId: normalizedStoryId,
            hideAvailable: true,
            context: hideAction.context,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, getPostHideContextStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
