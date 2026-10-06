import { createValidationError } from "../../api/validation.js";
import { buildCreativeEnhancementsOptOut } from "../../api/CreativeEnhancements.js";

export function buildCampaignCreativeFields({ options, name, preflight, imageHash }) {
    const { template, adCreative = null, utm = "" } = options;
    const creativeEnhancements = buildCreativeEnhancementsOptOut(template.disableCreativeEnhancements);
    const disableMultiAdvertiserAds = template.disableMultiAdvertiserAds !== false;
    let storyFields;
    if (options.creativeMode === "image") {
        const callToActionType = String(
            adCreative.callToActionType ?? "NO_BUTTON"
        ).trim().toUpperCase();
        if (!new Set([
            "NO_BUTTON",
            "LEARN_MORE",
            "SHOP_NOW",
            "SIGN_UP",
        ]).has(callToActionType)) {
            throw createValidationError(
                "Непідтримуваний тип кнопки рекламного оголошення",
                "CAMPAIGN_AD_CALL_TO_ACTION_INVALID"
            );
        }
        storyFields = {
            object_story_spec: {
                page_id: preflight.pageId,
                link_data: {
                    image_hash: imageHash,
                    link: String(adCreative.siteUrl ?? "").trim(),
                    name: String(adCreative.headline ?? "").trim(),
                    message: String(adCreative.primaryText ?? "").trim(),
                    ...(callToActionType !== "NO_BUTTON" ? {
                        call_to_action: {
                            type: callToActionType,
                            value: {
                                link: String(adCreative.siteUrl ?? "").trim(),
                            },
                        },
                    } : {}),
                },
            },
        };
    } else {
        storyFields = {
            object_story_id: preflight.postId,
        };
    }
    return {
        name: `${name} | Creative`,
        ...storyFields,
        url_tags: String(utm ?? "").trim(),
        ...(creativeEnhancements ? {
            degrees_of_freedom_spec: creativeEnhancements,
        } : {}),
        ...(disableMultiAdvertiserAds ? {
            contextual_multi_ads: { enroll_status: "OPT_OUT" },
        } : {}),
        ...(preflight.instagramActorId
            ? { instagram_actor_id: preflight.instagramActorId }
            : {}),
    };
}
