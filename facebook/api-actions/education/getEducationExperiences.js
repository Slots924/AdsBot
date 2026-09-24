import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "./common.js";


const friendlyName = "ProfileCometAboutAppSectionQuery";
const docId = "28648420368126790";

// Relay-прапорці перехоплено з робочого ProfileCometAboutAppSectionQuery.
const defaultRelayVariables = Object.freeze({
    __relay_internal__pv__FBProfile_enable_perf_improv_gkrelayprovider: true,
    __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
    __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
    __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
    __relay_internal__pv__FBUnifiedVideoMediaContentContainer_comet_reels_video_footer_defer_loading_gkrelayprovider: true,
    __relay_internal__pv__FBUnifiedVideoMediaContentContainer_comet_video_document_picture_in_picture_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoMediaContentContainer_enable_chapters_pill_gkrelayprovider: false,
    __relay_internal__pv__ShouldEnableBakedInTextUnifiedVideorelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoCometVideoMedia_comet_photosensitive_content_warning_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoMediaHeaderControls_enable_chapters_pill_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
    __relay_internal__pv__FBUnifiedVideoMediaFooter_organic_ad_cta_on_comet_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_meta_ai_pill_gkrelayprovider: true,
    __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_ai_embodiment_chat_pill_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoMediaFooter_enable_video_augment_pills_gkrelayprovider: true,
    __relay_internal__pv__FBUnifiedVideoPlayerScrubber_fb_comet_vpv_heatmap_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoDescriptionWithEntities_comet_translations_revamp_sync_caption_with_audio_gkrelayprovider: false,
    __relay_internal__pv__FBUnifiedVideoFeedbackBar_comet_reels_save_button_gkrelayprovider: false,
    __relay_internal__pv__usePushPipEngagementCounts_comet_video_document_picture_in_picture_gkrelayprovider: false,
    __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
    __relay_internal__pv__FBUnifiedVideoMenu_fb_reels_ranking_debug_tool_gkrelayprovider: false,
    __relay_internal__pv__CometAudioLanguageUtils_comet_translations_revamp_preferred_languages_gkrelayprovider: false,
});


export const getEducationExperiencesStatuses = Object.freeze({
    EDUCATION_FOUND: "EDUCATION_FOUND",
    EDUCATION_NOT_FOUND: "EDUCATION_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    INVALID_RESPONSE: "INVALID_RESPONSE",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Дістає College з точного GraphQL-шляху About section response.
function extractEducationExperiences(data) {
    const experiences = [];
    const seen = new Set();
    const collections = data?.data?.user?.about_app_sections?.nodes ?? [];

    collections.forEach((collection) => {
        const activeCollections = collection?.activeCollections?.nodes ?? [];

        activeCollections.forEach((activeCollection) => {
            const sections = activeCollection?.style_renderer
                ?.profile_field_sections ?? [];

            sections.forEach((section) => {
                if (section?.field_section_type !== "directory_college") {
                    return;
                }

                const nodes = section?.profile_fields?.nodes ?? [];
                nodes.forEach((node) => {
                    if (node?.field_type === "upsell") return;

                    const educationExperience = node?.edit_renderer
                        ?.education_experience;
                    const schoolName = node?.title?.text;
                    const educationExperienceId = educationExperience?.id;

                    if (!schoolName || !educationExperienceId) return;

                    const id = String(educationExperienceId);
                    if (seen.has(id)) return;

                    seen.add(id);
                    experiences.push({
                        school_name: schoolName,
                        education_experience_id: id,
                    });
                });
            });
        });
    });

    return experiences;
}


// Отримує наявні College та їх EducationExperience ID через About App Section GraphQL query.
export default async function getEducationExperiences({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    rawSectionToken,
    relayVariables = {},
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (
        validationError
        || !collectionToken
        || !sectionToken
        || !rawSectionToken
        || typeof relayVariables !== "object"
        || Array.isArray(relayVariables)
    ) {
        return createResult(
            false,
            getEducationExperiencesStatuses.INVALID_INPUT,
            null,
            {
                error: validationError
                    ?? "Потрібні collectionToken, sectionToken, rawSectionToken і relayVariables-об'єкт",
            }
        );
    }

    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload[field] === undefined || commonPayload[field] === null);
    if (missingRequestField) {
        return createResult(
            false,
            getEducationExperiencesStatuses.INVALID_INPUT,
            null,
            { error: `У commonPayload відсутнє поле ${missingRequestField}` }
        );
    }

    const profileId = String(commonPayload.__user);
    const variables = {
        ...defaultRelayVariables,
        ...relayVariables,
        appSectionFeedKey:
            `ProfileCometAppSectionFeed_timeline_nav_app_sections__${rawSectionToken}`,
        collectionToken,
        pageID: profileId,
        rawSectionToken,
        scale: 1,
        sectionToken,
        showReactions: true,
        userID: profileId,
    };
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

    try {
        const response = await postFacebookForm(page, {
            body,
            friendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, getEducationExperiencesStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, getEducationExperiencesStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, getEducationExperiencesStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, getEducationExperiencesStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
            });
        }

        if (hasGraphqlErrors(data)) {
            return createResult(false, getEducationExperiencesStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }
        if (!data?.data?.user) {
            return createResult(false, getEducationExperiencesStatuses.INVALID_RESPONSE, null, {
                error: "У GraphQL-відповіді відсутнє поле data.user",
                httpStatus: response.statusCode,
            });
        }

        const experiences = extractEducationExperiences(data);
        return createResult(
            true,
            experiences.length
                ? getEducationExperiencesStatuses.EDUCATION_FOUND
                : getEducationExperiencesStatuses.EDUCATION_NOT_FOUND,
            experiences,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(false, getEducationExperiencesStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
