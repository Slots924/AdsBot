import { randomUUID } from "node:crypto";

import { getProfilePhotoRejectReason }
    from "../../../services/accounts/photoSets.js";
import loadImageFromPath
    from "../../../services/images/loadImageFromPath.js";
import uploadProfilePhoto from "../profile/uploadProfilePhoto.js";
import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const photoUploadEndpoint = "https://upload.facebook.com/ajax/react_composer/attachments/photo/upload";
const createPostFriendlyName = "ComposerStoryCreateMutation";
const createPostDocId = "38869657952681417";

const relayProviderVariables = Object.freeze({
    __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
    __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
    __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
    __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
    __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: "AUTO_TRANSLATE",
    __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
    __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
    __relay_internal__pv__IsWorkUserrelayprovider: false,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    __relay_internal__pv__CometUFISingleLineUFIrelayprovider: true,
    __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
    __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
    __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
    __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
    __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
    __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: false,
    __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
    __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
    __relay_internal__pv__IsMergQAPollsrelayprovider: false,
    __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
    __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
    __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
    __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
    __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
    __relay_internal__pv__StoriesShouldEnablePhotosensitiveContentWarningrelayprovider: false,
    __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
    __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: true,
    __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
    __relay_internal__pv__GHLShouldChangeSponsoredAuctionDistanceFieldNamerelayprovider: true,
    __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV1relayprovider: true,
    __relay_internal__pv__GHLShouldUseSponsoredAuctionLabelFieldNameV2relayprovider: false,
});


export const createPublicPhotoPostStatuses = Object.freeze({
    CREATED: "CREATED",
    INVALID_INPUT: "INVALID_INPUT",
    INVALID_IMAGE: "INVALID_IMAGE",
    UPLOAD_TIMEOUT: "UPLOAD_TIMEOUT",
    UPLOAD_HTTP_ERROR: "UPLOAD_HTTP_ERROR",
    UPLOAD_PARSE_ERROR: "UPLOAD_PARSE_ERROR",
    UPLOAD_INVALID_RESPONSE: "UPLOAD_INVALID_RESPONSE",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Дістає необов'язкові корисні ідентифікатори зі відповіді створення поста.
function extractCreatedPostData(data) {
    const created = data?.data?.story_create ?? null;
    const story = created?.story ?? null;
    const node = created?.timeline_feed_units_edge?.node ?? null;

    return {
        postId: node?.post_id ?? null,
        storyId: story?.id ?? null,
        url: story?.url ?? node?.wwwURL ?? null,
        photoId: node?.attachments?.[0]?.media?.id ?? null,
    };
}


// Створює новий технічний ID, яким Composer пов'язує multipart-завантаження з постом.
function createUploadId() {
    return `jsc_c_${randomUUID()}`;
}


// Завантажує одне фото та створює від імені профілю публічний пост без тексту.
export default async function createPublicPhotoPost({
    page,
    commonPayload,
    imagePath,
    attributionId = null,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    if (validationError || missingRequestField || !String(imagePath ?? "").trim()) {
        return createResult(false, createPublicPhotoPostStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібен шлях до файлу зображення"),
        });
    }

    const imageRejectReason = await getProfilePhotoRejectReason(imagePath);
    if (imageRejectReason) {
        return createResult(false, createPublicPhotoPostStatuses.INVALID_IMAGE, null, {
            error: imageRejectReason,
        });
    }

    try {
        const image = await loadImageFromPath(imagePath);
        const profileId = String(commonPayload.__user);
        const normalizedTimeout = normalizeTimeout(timeout);
        const uploadId = createUploadId();
        const uploadResponse = await uploadProfilePhoto(page, {
            endpoint: photoUploadEndpoint,
            image,
            profileId,
            commonPayload,
            timeout: normalizedTimeout,
            formParameters: {
                source: "8",
                waterfallxapp: "comet",
                upload_id: uploadId,
            },
            fileFieldName: "farr",
        });

        if (uploadResponse.requestError === "TIMEOUT") {
            return createResult(false, createPublicPhotoPostStatuses.UPLOAD_TIMEOUT, null, {
                stage: "UPLOAD",
            });
        }
        if (uploadResponse.requestError) {
            return createResult(false, createPublicPhotoPostStatuses.REQUEST_FAILED, null, {
                stage: "UPLOAD",
                error: uploadResponse.requestError,
            });
        }
        if (!uploadResponse.ok) {
            return createResult(false, createPublicPhotoPostStatuses.UPLOAD_HTTP_ERROR, null, {
                stage: "UPLOAD",
                httpStatus: uploadResponse.statusCode,
            });
        }

        let uploadData;
        try {
            uploadData = parseFacebookJson(uploadResponse.body);
        } catch (error) {
            return createResult(false, createPublicPhotoPostStatuses.UPLOAD_PARSE_ERROR, null, {
                stage: "UPLOAD",
                error: String(error?.message ?? error),
            });
        }

        const uploadedPhotoId = uploadData?.payload?.photoID;
        if (!uploadedPhotoId) {
            return createResult(
                false,
                createPublicPhotoPostStatuses.UPLOAD_INVALID_RESPONSE,
                uploadData,
                {
                    stage: "UPLOAD",
                    error: "Facebook не повернув ID завантаженого фото",
                    httpStatus: uploadResponse.statusCode,
                }
            );
        }

        const composerSessionId = randomUUID();
        const input = {
            composer_entry_point: "inline_composer",
            composer_source_surface: "timeline",
            idempotence_token: `${composerSessionId}_FEED`,
            source: "WWW",
            attachments: [{
                photo: {
                    id: String(uploadedPhotoId),
                },
            }],
            audience: {
                privacy: {
                    allow: [],
                    base_state: "EVERYONE",
                    deny: [],
                    tag_expansion_state: "UNSPECIFIED",
                },
            },
            message: {
                ranges: [],
                text: "",
            },
            with_tags_ids: null,
            inline_activities: [],
            text_format_preset_id: "0",
            ai_generated_self_disclosure_metadata: {
                was_self_disclosed_as_ai_generated: false,
            },
            publishing_flow: {
                supported_flows: ["ASYNC_SILENT", "ASYNC_NOTIF", "FALLBACK"],
            },
            post_publish_story_data: {
                reshare_post_as_sticker: "DISABLED",
            },
            actor_id: profileId,
            client_mutation_id: "1",
            logging: {
                composer_session_id: composerSessionId,
            },
        };
        if (typeof attributionId === "string" && attributionId.trim()) {
            input.navigation_data = {
                attribution_id_v2: attributionId.trim(),
            };
        }

        const body = buildMutationBody(commonPayload, {
            friendlyName: createPostFriendlyName,
            docId: createPostDocId,
            variables: {
                input,
                feedLocation: "TIMELINE",
                feedbackSource: 0,
                focusCommentID: null,
                gridMediaWidth: 230,
                groupID: null,
                scale: 1,
                privacySelectorRenderLocation: "COMET_STREAM",
                checkPhotosToReelsUpsellEligibility: true,
                referringStoryRenderLocation: null,
                renderLocation: "timeline",
                useDefaultActor: false,
                inviteShortLinkKey: null,
                isFeed: false,
                isFundraiser: false,
                isFunFactPost: false,
                isGroup: false,
                isEvent: false,
                isTimeline: true,
                isSocialLearning: false,
                isPageNewsFeed: false,
                isProfileReviews: false,
                isWorkSharedDraft: false,
                ...relayProviderVariables,
            },
            extraParameters: {
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
            },
        });
        const createResponse = await postFacebookForm(page, {
            body,
            friendlyName: createPostFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
        });

        if (createResponse.requestError === "TIMEOUT") {
            return createResult(false, createPublicPhotoPostStatuses.REQUEST_TIMEOUT, null, {
                stage: "CREATE",
            });
        }
        if (createResponse.requestError) {
            return createResult(false, createPublicPhotoPostStatuses.REQUEST_FAILED, null, {
                stage: "CREATE",
                error: createResponse.requestError,
            });
        }
        if (!createResponse.ok) {
            return createResult(false, createPublicPhotoPostStatuses.HTTP_ERROR, null, {
                stage: "CREATE",
                httpStatus: createResponse.statusCode,
            });
        }

        let createData;
        try {
            createData = parseFacebookJson(createResponse.body);
        } catch (error) {
            return createResult(false, createPublicPhotoPostStatuses.PARSE_ERROR, null, {
                stage: "CREATE",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(createData)) {
            return createResult(false, createPublicPhotoPostStatuses.GRAPHQL_ERROR, createData, {
                stage: "CREATE",
                httpStatus: createResponse.statusCode,
            });
        }

        return createResult(true, createPublicPhotoPostStatuses.CREATED, {
            uploadedPhotoId: String(uploadedPhotoId),
            uploadedImageUrl: uploadData?.payload?.imageSrc ?? null,
            uploadedImageWidth: uploadData?.payload?.width ?? null,
            uploadedImageHeight: uploadData?.payload?.height ?? null,
            ...extractCreatedPostData(createData),
        }, {
            httpStatus: createResponse.statusCode,
        });
    } catch (error) {
        return createResult(false, createPublicPhotoPostStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
