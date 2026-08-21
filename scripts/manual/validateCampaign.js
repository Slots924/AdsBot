import "dotenv/config";

import createFacebookApiClients
    from "../../facebook/api/createFacebookApiClients.js";
import { normalizeTemplateInput }
    from "../../services/templates/CampaignTemplateManager.js";


function required(name) {
    const value = String(process.env[name] ?? "").trim();
    if (!value) {
        throw new Error(`Не задано обов’язкову змінну ${name}`);
    }
    return value;
}


if (process.env.ADSBOT_ALLOW_LIVE_CAMPAIGN_VALIDATION !== "1") {
    throw new Error(
        "Live validation вимкнено. Явно задайте ADSBOT_ALLOW_LIVE_CAMPAIGN_VALIDATION=1"
    );
}

const accountKey = required("ADSBOT_CAMPAIGN_ACCOUNT_KEY");
const countryCodes = required("ADSBOT_CAMPAIGN_COUNTRIES")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
const dailyBudget = Number(process.env.ADSBOT_CAMPAIGN_DAILY_BUDGET ?? 5);
const startTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
const beneficiary = String(
    process.env.ADSBOT_CAMPAIGN_DSA_BENEFICIARY ?? ""
).trim();
const payor = String(process.env.ADSBOT_CAMPAIGN_DSA_PAYOR ?? "").trim();
const template = normalizeTemplateInput({
    name: "AdsBot live validation",
    countryCodes,
    gender: "any",
    ageMin: 18,
    ageMax: 65,
    placements: { facebook: ["feed"], instagram: [] },
    shareAdSetBudget: false,
    dsaBeneficiary: beneficiary,
    dsaPayorSameAsBeneficiary: !payor,
    dsaPayor: payor,
});

const clients = await createFacebookApiClients();
const api = clients.get(accountKey);
if (!api) {
    throw new Error(`Facebook API-клієнт "${accountKey}" не знайдено`);
}

console.log("Запускаємо ручний Meta preflight у режимі validate_only…");
const result = await api.preflightLeadCampaign({
    adAccountId: required("ADSBOT_CAMPAIGN_AD_ACCOUNT_ID"),
    pageId: required("ADSBOT_CAMPAIGN_PAGE_ID"),
    postId: required("ADSBOT_CAMPAIGN_POST_ID"),
    pixelId: required("ADSBOT_CAMPAIGN_PIXEL_ID"),
    template,
    dailyBudget,
    startTime,
});

console.log("Meta validate_only пройдено успішно");
console.table([{
    adAccountId: result.adAccountId,
    currency: result.currency,
    pageId: result.pageId,
    postId: result.postId,
    pixelId: result.pixel.id,
    countries: countryCodes.join(","),
    dailyBudgetMinor: result.dailyBudgetMinor,
    dsaSource: result.dsa?.beneficiarySource ?? "not-required",
}]);
