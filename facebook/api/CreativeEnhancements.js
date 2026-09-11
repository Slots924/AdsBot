// Каталог підтримуваних Meta-покращень креативу.
// Щоб додати нове покращення, достатньо додати його ключ сюди: він
// автоматично піде в OPT_OUT-запит і в перевірку після створення реклами.
export const CREATIVE_ENHANCEMENT_CATALOG = Object.freeze([
    "standard_enhancements", "advantage_plus_creative",
    "adapt_to_placement", "add_text_overlay", "audio", "carousel_to_video",
    "cv_transformation", "image_animation", "image_auto_crop",
    "image_background_gen", "image_brightness_and_contrast",
    "image_enhancement", "image_templates", "image_text_translation",
    "image_touchups", "image_uncrop", "media_liquidity_animated_image",
    "media_order", "media_type_automation", "multi_creative_post_carousel",
    "multi_photo_to_video", "music_generation", "pac_genai_recomposition",
    "pac_recomposition", "pac_relaxation", "video_auto_crop",
    "video_filtering", "video_highlight", "video_highlights", "video_to_image",
    "video_uncrop", "video_uncrop_9x16_to_9x18", "video_voiceover",
    "description_automation", "dynamic_cta_text", "enhance_cta",
    "feed_caption_optimization", "generate_cta", "text_extraction_for_headline",
    "text_extraction_for_tap_target", "text_formatting_optimization",
    "text_generation", "text_optimizations", "text_overlay_translation",
    "text_translation", "translate_voiceover", "auto_promotion_tag",
    "catalog_feed_tag", "customize_product_recommendation", "dha_optimization",
    "product_browsing", "product_extensions", "product_metadata_automation",
    "product_tags", "site_extensions",
]);

export function buildCreativeEnhancementsOptOut(disabled = true) {
    if (!disabled) return undefined;
    return {
        creative_features_spec: Object.fromEntries(
            CREATIVE_ENHANCEMENT_CATALOG.map((key) => [
                key,
                { enroll_status: "OPT_OUT" },
            ])
        ),
    };
}

export function verifyCreativeEnhancementsOptOut(returnedFeatures, disabled = true) {
    if (!disabled) return { missing: [], enabled: [] };
    return CREATIVE_ENHANCEMENT_CATALOG.reduce((result, key) => {
        const status = returnedFeatures?.[key]?.enroll_status;
        if (!status) result.missing.push(key);
        else if (status !== "OPT_OUT") result.enabled.push(key);
        return result;
    }, { missing: [], enabled: [] });
}
