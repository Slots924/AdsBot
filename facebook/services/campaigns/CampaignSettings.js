import { createValidationError, normalizeAdAccountId, normalizeObjectId } from "../../api/validation.js";
import { buildCampaignBudgetSettings } from "./CampaignBudget.js";
import { buildCreativeEnhancementsOptOut, verifyCreativeEnhancementsOptOut } from "../../api/CreativeEnhancements.js";

const europeanDsaCountries = new Set([
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);


function isFacebookHost(hostname) {
    const host = String(hostname ?? "").toLowerCase();
    return host === "facebook.com" || host.endsWith(".facebook.com");
}


function isExternalWebsiteUrl(value) {
    try {
        let parsed = new URL(String(value ?? "").replace(/[),.;!?]+$/, ""));
        if (isFacebookHost(parsed.hostname) && parsed.pathname === "/l.php") {
            const target = parsed.searchParams.get("u");
            if (!target) return false;
            parsed = new URL(target);
        }
        const host = parsed.hostname.toLowerCase();
        return !isFacebookHost(host)
            && host !== "fb.com"
            && !host.endsWith(".fb.com");
    } catch {
        return false;
    }
}


function attachmentUrls(attachments = []) {
    return (Array.isArray(attachments) ? attachments : []).flatMap(
        (attachment) => [
            attachment?.unshimmed_url,
            attachment?.url,
            attachment?.target?.url,
            ...attachmentUrls(attachment?.subattachments?.data),
        ]
    ).filter(Boolean);
}


export function hasExternalWebsiteUrl(post) {
    const messageUrls = String(post?.message ?? "")
        .match(/https?:\/\/[^\s]+/gi) ?? [];
    return [
        ...messageUrls,
        ...attachmentUrls(post?.attachments?.data),
    ].some(isExternalWebsiteUrl);
}


export function buildTargeting(template) {
    const facebookPositions = (template.placements?.facebook ?? []).map(
        (position) => position === "reels" ? "facebook_reels" : position
    );
    const instagramPositions = template.placements?.instagram ?? [];
    const publisherPlatforms = [
        ...(facebookPositions.length ? ["facebook"] : []),
        ...(instagramPositions.length ? ["instagram"] : []),
    ];
    const gender = template.gender === "male"
        ? [1]
        : template.gender === "female" ? [2] : undefined;

    return {
        age_min: template.ageMin,
        age_max: template.ageMax,
        geo_locations: { countries: template.countryCodes },
        ...(template.locales?.length ? { locales: template.locales } : {}),
        publisher_platforms: publisherPlatforms,
        ...(facebookPositions.length
            ? { facebook_positions: facebookPositions }
            : {}),
        ...(instagramPositions.length
            ? { instagram_positions: instagramPositions }
            : {}),
        ...(gender ? { genders: gender } : {}),
        ...(template.devicePlatforms?.length
            ? { device_platforms: template.devicePlatforms }
            : {}),
        ...(template.operatingSystems?.length
            ? { user_os: template.operatingSystems }
            : {}),
        targeting_automation: { advantage_audience: 0 },
    };
}


export function resolveDsaSettings(template, account) {
    const countries = Array.isArray(template.countryCodes)
        ? template.countryCodes.map((code) => String(code).toUpperCase())
        : [];
    const requiredForEurope = countries.some((code) => (
        europeanDsaCountries.has(code)
    ));
    const templateBeneficiary = String(
        template.dsaBeneficiary ?? ""
    ).trim();
    const templatePayor = template.dsaPayorSameAsBeneficiary !== false
        ? templateBeneficiary
        : String(template.dsaPayor ?? "").trim();
    const defaultBeneficiary = String(
        account.default_dsa_beneficiary ?? ""
    ).trim();
    const defaultPayor = String(account.default_dsa_payor ?? "").trim();
    const shouldResolve = requiredForEurope
        || Boolean(templateBeneficiary)
        || Boolean(templatePayor);

    if (!shouldResolve) return null;

    const beneficiary = templateBeneficiary || defaultBeneficiary;
    const payor = templatePayor || defaultPayor;
    if (!beneficiary) {
        throw createValidationError(
            "Для європейської аудиторії вкажіть бенефіціара у шаблоні або налаштуйте default DSA beneficiary у Meta",
            "CAMPAIGN_DSA_BENEFICIARY_REQUIRED"
        );
    }
    if (!payor) {
        throw createValidationError(
            "Для європейської аудиторії вкажіть платника у шаблоні або налаштуйте default DSA payor у Meta",
            "CAMPAIGN_DSA_PAYOR_REQUIRED"
        );
    }

    return {
        beneficiary,
        payor,
        beneficiarySource: templateBeneficiary ? "template" : "meta-default",
        payorSource: templatePayor ? "template" : "meta-default",
        requiredForEurope,
    };
}


export function prepareLeadCampaignInput({
    adAccountId,
    pageId,
    postId,
    template,
    pixelId,
    startTime,
    creativeMode = "post",
    siteUrl = "",
}) {
    const accountId = normalizeAdAccountId(adAccountId);
    const normalizedPageId = normalizeObjectId(
        pageId,
        "CAMPAIGN_PAGE_ID_INVALID",
        "ID фанпейджі"
    );
    const imageCreative = creativeMode === "image";
    let storyId = null;
    if (imageCreative) {
        let destination;
        try {
            destination = new URL(String(siteUrl ?? "").trim());
        } catch {
            throw createValidationError(
                "Вкажіть коректне посилання на офер",
                "CAMPAIGN_SITE_URL_INVALID"
            );
        }
        if (!["http:", "https:"].includes(destination.protocol)) {
            throw createValidationError(
                "Посилання на офер має починатися з http:// або https://",
                "CAMPAIGN_SITE_URL_INVALID"
            );
        }
    } else {
        const rawPostId = String(postId ?? "").trim();
        storyId = rawPostId.includes("_")
            ? rawPostId
            : `${normalizedPageId}_${normalizeObjectId(
                rawPostId,
                "CAMPAIGN_POST_ID_INVALID",
                "Post ID"
            )}`;
        if (!storyId.startsWith(`${normalizedPageId}_`)) {
            throw createValidationError(
                "Вказаний пост не належить вибраній фанпейджі",
                "CAMPAIGN_POST_PAGE_MISMATCH"
            );
        }
    }
    if (!pixelId) {
        throw createValidationError(
            "Не вказано Pixel ID",
            "CAMPAIGN_PIXEL_REQUIRED"
        );
    }
    if (!Array.isArray(template.countryCodes) || !template.countryCodes.length) {
        throw createValidationError(
            "У шаблоні потрібно вибрати хоча б одну країну",
            "CAMPAIGN_COUNTRY_REQUIRED"
        );
    }

    const normalizedStart = new Date(startTime);
    if (Number.isNaN(normalizedStart.getTime())) {
        throw createValidationError(
            "Некоректний час початку показів",
            "CAMPAIGN_START_TIME_INVALID"
        );
    }

    return { accountId, normalizedPageId, imageCreative, storyId, normalizedStart };
}


export function buildCampaignFields(name, template, preflight = {}) {
    return {
        name,
        objective: "OUTCOME_LEADS",
        status: "PAUSED",
        special_ad_categories: [],
        ...buildCampaignBudgetSettings(template.shareAdSetBudget, preflight).campaign,
    };
}


export function buildAdSetFields({ name, ordinal, campaignId, template, preflight }) {
    return {
        name: `${name} | AS ${ordinal}`,
        campaign_id: campaignId,
        ...(preflight.budgetMode === "campaign" ? {} : {
            daily_budget: preflight.dailyBudgetMinor,
            ...buildCampaignBudgetSettings(template.shareAdSetBudget).adSet,
        }),
        billing_event: "IMPRESSIONS",
        optimization_goal: "OFFSITE_CONVERSIONS",
        promoted_object: {
            pixel_id: preflight.pixel.id,
            custom_event_type: "LEAD",
        },
        targeting: preflight.targeting,
        start_time: preflight.startTime,
        status: "PAUSED",
        ...(preflight.dsa ? {
            dsa_beneficiary: preflight.dsa.beneficiary,
            dsa_payor: preflight.dsa.payor,
        } : {}),
    };
}


export function buildAdFields({ name, ordinal, adSetId, creativeId, creativeName }) {
    const number = String(creativeName ?? "").trim().replace(/^Creo_/i, "");
    const countPattern = /\|\s*\d+\s+креативів(?=\s*\||$)/u;
    const adName = number
        ? countPattern.test(name)
            ? name.replace(countPattern, () => `| Creo_${number}`)
            : `${name} | Creo_${number}`
        : name;
    return {
        name: `${adName} | AD ${ordinal}`,
        adset_id: adSetId,
        creative: { creative_id: creativeId },
        status: "PAUSED",
    };
}


export function verifyCampaignReadback({ readback, preflight, template }) {
    const { creative: creativeReadback, adSets: adSetsReadback } = readback;
    const creativeEnhancements = buildCreativeEnhancementsOptOut(template.disableCreativeEnhancements);
    const disableMultiAdvertiserAds = template.disableMultiAdvertiserAds !== false;
    const returnedFeatures = creativeReadback
        ?.degrees_of_freedom_spec
        ?.creative_features_spec;
    const warnings = [];
    if (creativeEnhancements && !returnedFeatures) {
        warnings.push(
            "Meta не повернула creative_features_spec для контрольної перевірки"
        );
    } else if (creativeEnhancements) {
        const verification = verifyCreativeEnhancementsOptOut(
            returnedFeatures
        );
        if (verification.enabled.length) {
            warnings.push(
                `Meta не підтвердила OPT_OUT: ${verification.enabled.join(", ")}`
            );
        }
        if (verification.missing.length) {
            warnings.push(
                `Meta не підтвердила стан покращень: ${verification.missing.join(", ")}`
            );
        }
    }
    if (
        disableMultiAdvertiserAds
        && creativeReadback?.contextual_multi_ads?.enroll_status !== "OPT_OUT"
    ) {
        warnings.push(
            "Meta не підтвердила вимкнення Multi-advertiser ads"
        );
    }
    if (preflight.dsa) {
        adSetsReadback.forEach((adSet, index) => {
            if (
                adSet.dsa_beneficiary !== preflight.dsa.beneficiary
                || adSet.dsa_payor !== preflight.dsa.payor
            ) {
                warnings.push(
                    `Ad set ${index + 1}: Meta не підтвердила очікувані DSA beneficiary/payor`
                );
            }
        });
    }
    return warnings;
}
