import { createValidationError, normalizeObjectId } from "../api/validation.js";
import { budgetToMinorUnits } from "../services/campaigns/CampaignBudget.js";
import {
    prepareLeadCampaignInput,
    hasExternalWebsiteUrl,
    resolveDsaSettings,
    buildTargeting,
    buildCampaignFields,
} from "../services/campaigns/CampaignSettings.js";

export default async function preflightLeadCampaign({
    adAccountId,
    pageId,
    postId,
    template,
    pixelId,
    dailyBudget,
    startTime,
    creativeMode = "post",
    siteUrl = "",
}, operations) {
    const { accountId, normalizedPageId, imageCreative, storyId, normalizedStart }
        = prepareLeadCampaignInput({
            adAccountId, pageId, postId, template, pixelId,
            startTime, creativeMode, siteUrl,
        });

    const permissions = await operations.getPermissions();
    if (!permissions.granted.includes("ads_management")) {
        throw createValidationError(
            "Access token не має дозволу ads_management",
            "CAMPAIGN_ADS_MANAGEMENT_REQUIRED"
        );
    }

    const account = await operations.getAccount(accountId);
    if (Number(account.account_status) !== 1) {
        throw createValidationError(
            `Рекламний акаунт неактивний (status ${account.account_status})`,
            "CAMPAIGN_AD_ACCOUNT_INACTIVE"
        );
    }

    const page = await operations.getPage(normalizedPageId);
    if (!imageCreative) {
        const post = await operations.getPost(storyId, page.pageAccessToken);
        if (post.is_published === false) {
            throw createValidationError(
                "Пост не опублікований",
                "CAMPAIGN_POST_NOT_PUBLISHED"
            );
        }
        if (!hasExternalWebsiteUrl(post)) {
            throw createValidationError(
                "У пості не знайдено посилання на зовнішній сайт",
                "CAMPAIGN_POST_WEBSITE_URL_REQUIRED"
            );
        }
    }

    const pixels = await operations.getPixels(accountId);
    const normalizedPixelId = normalizeObjectId(
        pixelId,
        "CAMPAIGN_PIXEL_ID_INVALID",
        "Pixel ID"
    );
    const pixel = pixels.find((item) => String(item.id) === normalizedPixelId);
    if (!pixel) {
        throw createValidationError(
            "Вибраний Pixel недоступний цьому рекламному акаунту",
            "CAMPAIGN_PIXEL_ACCESS_DENIED"
        );
    }

    let instagramActorId = null;
    if (template.placements?.instagram?.length) {
        const pageDetails = await operations.getInstagramAccount(normalizedPageId, page.pageAccessToken);
        instagramActorId = pageDetails.instagram_business_account?.id ?? null;
        if (!instagramActorId) {
            throw createValidationError(
                "Для Instagram placements до фанпейджі має бути прив’язаний Instagram business account",
                "CAMPAIGN_INSTAGRAM_ACTOR_REQUIRED"
            );
        }
    }

    const budgetMinor = budgetToMinorUnits(dailyBudget, account.currency);
    const dsa = resolveDsaSettings(template, account);
    await operations.validateCampaign(accountId, buildCampaignFields("AdsBot preflight", template));

    return {
        adAccountId: accountId,
        accountName: account.name ?? "",
        currency: account.currency,
        timezoneName: account.timezone_name,
        pageId: normalizedPageId,
        pageName: page.name,
        postId: storyId,
        pixel: { id: pixel.id, name: pixel.name ?? "" },
        instagramActorId,
        dailyBudgetMinor: budgetMinor,
        startTime: normalizedStart.toISOString(),
        targeting: buildTargeting(template),
        dsa,
    };
}
