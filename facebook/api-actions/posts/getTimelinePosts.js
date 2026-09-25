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


const timelineFriendlyName = "ProfileCometTimelineFeedRefetchQuery";
const timelineDocId = "28498908596432653";

// УВАГА: цей endpoint віддає алгоритмічну стрічку, а не повний архів профілю.
// У ручній перевірці він повернув лише 3 story при наявності більшої кількості постів.
// Не використовувати його для повного переліку, масового видалення чи приховування постів.

const relayProviderVariables = Object.freeze({
    __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
    __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
    __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
    __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
    __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
    __relay_internal__pv__IsWorkUserrelayprovider: false,
    __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
    __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
    __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
    __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
    __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
    __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
    __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
    __relay_internal__pv__IsMergQAPollsrelayprovider: false,
    __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: "AUTO_TRANSLATE",
    __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
    __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
    __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
    __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
    __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
    __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
    __relay_internal__pv__StoriesShouldEnablePhotosensitiveContentWarningrelayprovider: false,
    __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
    __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
});


export const getTimelinePostsStatuses = Object.freeze({
    POSTS_FOUND: "POSTS_FOUND",
    POSTS_NOT_FOUND: "POSTS_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує розмір сторінки без припущення, що Facebook поверне рівно стільки story.
function normalizeCount(count) {
    const normalized = Number(count);
    return Number.isInteger(normalized) && normalized > 0 && normalized <= 100
        ? normalized
        : null;
}


function getAttachmentStyles(attachment) {
    const styles = attachment?.styles ?? {};
    const styleList = styles?.style_list ?? attachment?.style_list ?? [];

    return {
        renderer: styles?.__typename ?? null,
        styleList: Array.isArray(styleList) ? styleList : [],
    };
}


// Визначає лише підтверджені системні story без залежності від локалізованого тексту.
function getSystemType(attachments) {
    for (const attachment of attachments) {
        const { renderer, styleList } = getAttachmentStyles(attachment);
        if (
            renderer === "StoryAttachmentProfileMediaStyleRenderer"
            || styleList.includes("avatar")
        ) {
            return "AVATAR";
        }
        if (
            renderer === "StoryAttachmentCoverPhotoStyleRenderer"
            || styleList.includes("cover_photo")
        ) {
            return "COVER";
        }
    }

    return null;
}


// Перетворює feed unit у компактний опис поста без tracking та інших тимчасових token-полів.
function normalizePost(story) {
    const attachments = Array.isArray(story?.attachments) ? story.attachments : [];
    const systemType = getSystemType(attachments);

    return {
        storyId: story?.id ?? null,
        postId: story?.post_id ?? null,
        creationTime: story?.creation_time ?? null,
        message: story?.message?.text ?? story?.message ?? "",
        permalinkUrl: story?.permalink_url ?? story?.url ?? null,
        isSystem: systemType !== null,
        systemType,
        canViewMenu: story?.can_viewer_see_menu ?? null,
        attachments: attachments.map((attachment) => ({
            mediaId: attachment?.media?.id ?? null,
            mediaType: attachment?.media?.__typename ?? null,
            ...getAttachmentStyles(attachment),
        })),
    };
}


// Повертає поточну сторінку постів таймлайна та cursor для наступної сторінки.
export default async function getTimelinePosts({
    page,
    commonPayload,
    count = 10,
    cursor,
    variablesTemplate = null,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedCount = normalizeCount(count);
    const normalizedTemplate = variablesTemplate
        && typeof variablesTemplate === "object"
        && !Array.isArray(variablesTemplate)
        ? variablesTemplate
        : {};
    const normalizedCursor = cursor === undefined
        ? normalizedTemplate.cursor ?? null
        : (cursor === null || cursor === "" ? null : String(cursor));

    if (validationError || missingRequestField || !normalizedCount) {
        return createResult(false, getTimelinePostsStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "count має бути цілим числом від 1 до 100"),
        });
    }

    try {
        const normalizedTimeout = normalizeTimeout(timeout);
        const body = buildMutationBody(commonPayload, {
            friendlyName: timelineFriendlyName,
            docId: timelineDocId,
            variables: {
                afterTime: null,
                beforeTime: null,
                count: normalizedCount,
                cursor: normalizedCursor,
                feedLocation: "TIMELINE",
                feedbackSource: 0,
                focusCommentID: null,
                memorializedSplitTimeFilter: null,
                omitPinnedPost: true,
                postedBy: null,
                privacy: null,
                privacySelectorRenderLocation: "COMET_STREAM",
                referringStoryRenderLocation: null,
                renderLocation: "timeline",
                run_with_continuation_key: true,
                scale: 1,
                stream_count: 1,
                taggedInOnly: null,
                trackingCode: null,
                useDefaultActor: false,
                id: String(commonPayload.__user),
                ...relayProviderVariables,
                ...normalizedTemplate,
                count: normalizedCount,
                cursor: normalizedCursor,
                id: String(commonPayload.__user),
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
            friendlyName: timelineFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, getTimelinePostsStatuses.REQUEST_TIMEOUT, null, {
                stage: "GET_TIMELINE",
            });
        }
        if (response.requestError) {
            return createResult(false, getTimelinePostsStatuses.REQUEST_FAILED, null, {
                stage: "GET_TIMELINE",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, getTimelinePostsStatuses.HTTP_ERROR, null, {
                stage: "GET_TIMELINE",
                httpStatus: response.statusCode,
            });
        }

        let responseChunks;
        try {
            responseChunks = parseFacebookJsonChunks(response.body);
        } catch (error) {
            return createResult(false, getTimelinePostsStatuses.PARSE_ERROR, null, {
                stage: "GET_TIMELINE",
                error: String(error?.message ?? error),
            });
        }
        const data = parseFacebookJson(response.body);
        const errors = responseChunks.flatMap((chunk) => Array.isArray(chunk?.errors)
            ? chunk.errors
            : []);
        if (hasGraphqlErrors(data) || errors.length) {
            return createResult(false, getTimelinePostsStatuses.GRAPHQL_ERROR, {
                ...data,
                ...(errors.length ? { errors } : {}),
            }, {
                stage: "GET_TIMELINE",
                httpStatus: response.statusCode,
            });
        }

        const timelines = responseChunks
            .map((chunk) => chunk?.data?.node?.timeline_list_feed_units)
            .filter(Boolean);
        const edges = timelines.flatMap((timeline) => Array.isArray(timeline?.edges)
            ? timeline.edges
            : []);
        const posts = edges
            .map((edge) => normalizePost(edge?.node))
            .filter((post) => post.storyId);
        const pageInfo = timelines
            .map((timeline) => timeline?.page_info)
            .filter(Boolean)
            .at(-1)
            ?? responseChunks.findLast((chunk) => Array.isArray(chunk?.path)
                && chunk.path.join(".") === "node.timeline_list_feed_units"
                && chunk?.data?.page_info)?.data?.page_info
            ?? null;

        return createResult(
            true,
            posts.length
                ? getTimelinePostsStatuses.POSTS_FOUND
                : getTimelinePostsStatuses.POSTS_NOT_FOUND,
            {
                posts,
                pageInfo: {
                    endCursor: pageInfo?.end_cursor ?? null,
                    hasNextPage: pageInfo?.has_next_page ?? false,
                },
            },
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(false, getTimelinePostsStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
