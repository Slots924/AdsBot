import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    parseFacebookJsonChunks,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const managePostsFriendlyName = "ProfileCometManagePostsTimelineRootQuery";
const managePostsDocId = "27494860426853893";
const managePostsRefetchFriendlyName = "CometManagePostsFeedRefetchQuery";
const managePostsRefetchDocId = "28216705767950580";
const managePostsPageSize = 6;
const maxManagePostsPages = 100;


export const getManagePostsStatuses = Object.freeze({
    POSTS_FOUND: "POSTS_FOUND",
    POSTS_NOT_FOUND: "POSTS_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    PAGINATION_LIMIT_REACHED: "PAGINATION_LIMIT_REACHED",
    ERROR: "ERROR",
});


// Визначає тип системного поста лише за підтвердженими англомовними підписами Facebook.
function getSystemType(story) {
    const text = [story?.summary?.text, story?.title?.text]
        .filter(Boolean)
        .join(" ");

    if (/updated .*profile picture/i.test(text)) return "AVATAR";
    if (/updated .*cover photo/i.test(text)) return "COVER";

    return null;
}


function getNegativeFeedbackActionTypes(story) {
    const edges = story?.negative_feedback_actions?.edges;
    if (!Array.isArray(edges)) return [];

    return edges
        .map((edge) => edge?.node?.negative_feedback_action_type)
        .filter(Boolean);
}


// Повертає лише дані, необхідні для подальшого видалення або приховування поста.
function normalizePost(story) {
    const negativeFeedbackActionTypes = getNegativeFeedbackActionTypes(story);
    const systemType = getSystemType(story);

    return {
        storyId: story?.id ?? null,
        creationTime: story?.creation_time ?? story?.backdated_time?.time ?? null,
        message: story?.message?.text ?? story?.message ?? "",
        summary: story?.summary?.text ?? null,
        title: story?.title?.text ?? null,
        permalinkUrl: story?.url ?? story?.permalink_url ?? null,
        canDelete: story?.can_viewer_delete === true,
        canHide: negativeFeedbackActionTypes.includes("HIDE_FROM_TIMELINE"),
        isSystem: story?.can_viewer_delete === false
            && negativeFeedbackActionTypes.includes("HIDE_FROM_TIMELINE"),
        systemType,
    };
}


// Збирає initial та streamed edges, які Facebook повертає окремими JSON-фрагментами.
function collectStories(responseChunks) {
    const storiesByIndex = new Map();
    let fallbackIndex = 0;

    for (const chunk of responseChunks) {
        const initialEdges = chunk?.data?.user?.timeline_manage_feed_units?.edges
            ?? chunk?.data?.node?.timeline_manage_feed_units?.edges;
        if (Array.isArray(initialEdges)) {
            initialEdges.forEach((edge, index) => {
                if (edge?.node) storiesByIndex.set(index, edge.node);
            });
            fallbackIndex = Math.max(fallbackIndex, initialEdges.length);
        }

        const path = chunk?.path;
        const isStreamedEdge = Array.isArray(path)
            && (path[0] === "user" || path[0] === "node")
            && path[1] === "timeline_manage_feed_units"
            && path[2] === "edges"
            && Number.isInteger(path[3]);
        if (isStreamedEdge && chunk?.data?.node) {
            storiesByIndex.set(path[3], chunk.data.node);
        }
    }

    const stories = [...storiesByIndex.entries()]
        .sort(([firstIndex], [secondIndex]) => firstIndex - secondIndex)
        .map(([, story]) => story);

    // Захищаємося від нетипової відповіді без індексованих edge.
    if (!stories.length) {
        for (const chunk of responseChunks) {
            if (chunk?.data?.node && fallbackIndex >= 0) {
                stories.push(chunk.data.node);
                fallbackIndex += 1;
            }
        }
    }

    return stories;
}


function getPageInfo(responseChunks) {
    return responseChunks
        .map((chunk) => chunk?.data?.user?.timeline_manage_feed_units?.page_info
            ?? chunk?.data?.node?.timeline_manage_feed_units?.page_info)
        .find(Boolean)
        ?? responseChunks.findLast((chunk) => Array.isArray(chunk?.path)
            && ["user.timeline_manage_feed_units", "node.timeline_manage_feed_units"]
                .includes(chunk.path.join("."))
            && chunk?.data?.page_info)?.data?.page_info
        ?? null;
}


async function requestManagePostsPage({
    page,
    commonPayload,
    friendlyName,
    docId,
    variables,
    timeout,
}) {
    const body = buildMutationBody(commonPayload, {
        friendlyName,
        docId,
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
        friendlyName,
        lsd: commonPayload.lsd,
        timeout,
    });

    if (response.requestError === "TIMEOUT") {
        return createResult(false, getManagePostsStatuses.REQUEST_TIMEOUT, null, {
            stage: "GET_MANAGE_POSTS",
        });
    }
    if (response.requestError) {
        return createResult(false, getManagePostsStatuses.REQUEST_FAILED, null, {
            stage: "GET_MANAGE_POSTS",
            error: response.requestError,
        });
    }
    if (!response.ok) {
        return createResult(false, getManagePostsStatuses.HTTP_ERROR, null, {
            stage: "GET_MANAGE_POSTS",
            httpStatus: response.statusCode,
        });
    }

    let responseChunks;
    try {
        responseChunks = parseFacebookJsonChunks(response.body);
    } catch (error) {
        return createResult(false, getManagePostsStatuses.PARSE_ERROR, null, {
            stage: "GET_MANAGE_POSTS",
            error: String(error?.message ?? error),
        });
    }
    const data = parseFacebookJson(response.body);
    const errors = responseChunks.flatMap((chunk) => Array.isArray(chunk?.errors)
        ? chunk.errors
        : []);
    if (hasGraphqlErrors(data) || errors.length) {
        return createResult(false, getManagePostsStatuses.GRAPHQL_ERROR, {
            ...data,
            ...(errors.length ? { errors } : {}),
        }, {
            stage: "GET_MANAGE_POSTS",
            httpStatus: response.statusCode,
        });
    }

    return createResult(true, getManagePostsStatuses.POSTS_FOUND, {
        posts: collectStories(responseChunks)
            .map(normalizePost)
            .filter((post) => post.storyId),
        pageInfo: getPageInfo(responseChunks),
    }, {
        httpStatus: response.statusCode,
    });
}


// Отримує всі сторінки, доступні через підтверджені Manage Posts root і refetch queries.
export default async function getManagePosts({
    page,
    commonPayload,
    timeout,
    omitPinnedPost = true,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);

    if (validationError || missingRequestField) {
        return createResult(false, getManagePostsStatuses.INVALID_INPUT, null, {
            error: validationError ?? `У commonPayload відсутнє поле ${missingRequestField}`,
        });
    }

    try {
        const normalizedTimeout = normalizeTimeout(timeout);
        const rootVariables = {
            afterTime: null,
            beforeTime: null,
            gridMediaWidth: 230,
            includeGroupScheduledPosts: false,
            includeScheduledPosts: false,
            omitPinnedPost: omitPinnedPost === true,
            postedBy: null,
            privacy: null,
            privacySelectorRenderLocation: "COMET_STREAM",
            scale: 1,
            taggedInOnly: null,
            renderLocation: "timeline",
            userID: String(commonPayload.__user),
            __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
        };
        const rootResult = await requestManagePostsPage({
            page,
            commonPayload,
            friendlyName: managePostsFriendlyName,
            docId: managePostsDocId,
            variables: rootVariables,
            timeout: normalizedTimeout,
        });
        if (!rootResult.success) return rootResult;

        const posts = [...rootResult.data.posts];
        const knownStoryIds = new Set(posts.map((post) => post.storyId));
        let pageInfo = rootResult.data.pageInfo;
        let pagesLoaded = 1;

        while (pageInfo?.has_next_page && pagesLoaded < maxManagePostsPages) {
            if (!pageInfo.end_cursor) {
                return createResult(false, getManagePostsStatuses.ERROR, null, {
                    stage: "PAGINATION",
                    error: "Facebook не повернув cursor для наступної сторінки Manage Posts",
                });
            }

            const refetchResult = await requestManagePostsPage({
                page,
                commonPayload,
                friendlyName: managePostsRefetchFriendlyName,
                docId: managePostsRefetchDocId,
                variables: {
                    afterTime: null,
                    beforeTime: null,
                    count: managePostsPageSize,
                    cursor: pageInfo.end_cursor,
                    gridMediaWidth: 230,
                    includeGroupScheduledPosts: false,
                    includeScheduledPosts: false,
                    omitPinnedPost: omitPinnedPost === true,
                    postedBy: null,
                    privacy: null,
                    privacySelectorRenderLocation: "COMET_STREAM",
                    renderLocation: "timeline",
                    scale: 1,
                    taggedInOnly: null,
                    id: String(commonPayload.__user),
                    __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
                },
                timeout: normalizedTimeout,
            });
            if (!refetchResult.success) return refetchResult;

            for (const post of refetchResult.data.posts) {
                if (!knownStoryIds.has(post.storyId)) {
                    knownStoryIds.add(post.storyId);
                    posts.push(post);
                }
            }
            pageInfo = refetchResult.data.pageInfo;
            pagesLoaded += 1;
        }

        if (pageInfo?.has_next_page) {
            return createResult(false, getManagePostsStatuses.PAGINATION_LIMIT_REACHED, {
                posts,
                pageInfo: {
                    endCursor: pageInfo.end_cursor ?? null,
                    hasNextPage: true,
                },
                pagesLoaded,
            });
        }

        return createResult(
            true,
            posts.length
                ? getManagePostsStatuses.POSTS_FOUND
                : getManagePostsStatuses.POSTS_NOT_FOUND,
            {
                posts,
                pageInfo: {
                    endCursor: pageInfo?.end_cursor ?? null,
                    hasNextPage: pageInfo?.has_next_page ?? false,
                },
                pagesLoaded,
            },
            { httpStatus: rootResult.httpStatus }
        );
    } catch (error) {
        return createResult(false, getManagePostsStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
