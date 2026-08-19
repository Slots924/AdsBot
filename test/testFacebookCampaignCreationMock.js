import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";


const requests = [];
const counters = { campaign: 0, creative: 0, adset: 0, ad: 0 };
let accountDsaDefaults = {
    default_dsa_beneficiary: "Meta Beneficiary LLC",
    default_dsa_payor: "Meta Payor LLC",
};


function isValidate(config) {
    return config.data instanceof URLSearchParams
        && config.data.has("execution_options");
}


const api = new FacebookGraphApi({
    accountKey: "client",
    accessToken: "secret",
    cookie: "cookie",
    userAgent: "agent",
    proxyHttpClient: {
        async request(config) {
            requests.push(config);
            const path = new URL(config.url).pathname.replace("/v26.0", "");
            if (path === "/me/permissions") {
                return { data: { data: [{ permission: "ads_management", status: "granted" }] } };
            }
            if (path === "/act_1" && config.method === "get") {
                return { data: {
                    id: "act_1",
                    name: "Account",
                    account_status: 1,
                    currency: "USD",
                    timezone_name: "Europe/Kyiv",
                    ...accountDsaDefaults,
                } };
            }
            if (path === "/me/accounts") {
                return { data: { data: [{
                    id: "10",
                    name: "Page",
                    tasks: [
                        "PROFILE_PLUS_CREATE_CONTENT",
                        "PROFILE_PLUS_ADVERTISE",
                    ],
                    access_token: "page-secret",
                }] } };
            }
            if (path === "/10" && config.params.fields === "id,name,is_published") {
                return { data: { id: "10", name: "Page", is_published: true } };
            }
            if (path === "/10_20") {
                return { data: { id: "10_20", message: "Visit https://example.com", is_published: true } };
            }
            if (path === "/act_1/adspixels") {
                return { data: { data: [{ id: "30", name: "Lead pixel" }] } };
            }
            if (config.method === "post" && isValidate(config)) {
                return { data: { success: true } };
            }
            if (path === "/act_1/campaigns" && config.method === "post") {
                counters.campaign += 1;
                return { data: { id: `campaign-${counters.campaign}` } };
            }
            if (path === "/act_1/adcreatives" && config.method === "post") {
                counters.creative += 1;
                return { data: { id: `creative-${counters.creative}` } };
            }
            if (path === "/act_1/adsets" && config.method === "post") {
                counters.adset += 1;
                return { data: { id: `adset-${counters.adset}` } };
            }
            if (path === "/act_1/ads" && config.method === "post") {
                counters.ad += 1;
                return { data: { id: `ad-${counters.ad}` } };
            }
            if (path === "/campaign-1") {
                return { data: { id: "campaign-1", name: "Test", status: "PAUSED", effective_status: "PAUSED" } };
            }
            if (path === "/creative-1") {
                return { data: {
                    id: "creative-1",
                    name: "Creative",
                    degrees_of_freedom_spec: {
                        creative_features_spec: {
                            standard_enhancements: { enroll_status: "OPT_OUT" },
                        },
                    },
                } };
            }
            if (path.startsWith("/adset-")) {
                return { data: {
                    id: path.slice(1),
                    status: "PAUSED",
                    effective_status: "PAUSED",
                    dsa_beneficiary: "Meta Beneficiary LLC",
                    dsa_payor: "Meta Payor LLC",
                } };
            }
            if (path.startsWith("/ad-")) {
                return { data: { id: path.slice(1), status: "PAUSED", effective_status: "PAUSED" } };
            }
            throw new Error(`Неочікуваний mock-запит: ${config.method} ${path}`);
        },
    },
});

const template = {
    pixel: "30",
    countryCodes: ["HU", "US"],
    gender: "female",
    ageMin: 25,
    ageMax: 44,
    devicePlatforms: ["mobile"],
    operatingSystems: ["iOS"],
    placements: { facebook: ["feed"], instagram: [] },
    utm: "utm_campaign={{campaign.name}}",
    shareAdSetBudget: true,
};
const progress = [];
const result = await api.createLeadCampaign({
    adAccountId: "act_1",
    pageId: "10",
    postId: "20",
    campaignName: "Test",
    template,
    adSetCount: 2,
    dailyBudget: 5,
    startTime: "2026-08-20T10:00:00.000Z",
    createPaused: true,
}, (event) => progress.push(event));

assert.equal(result.objects.campaignId, "campaign-1");
assert.equal(result.objects.adSets.length, 2);
assert.equal(result.objects.ads.length, 2);
assert.equal(result.preflight.dailyBudgetMinor, "500");
assert.deepEqual(result.preflight.dsa, {
    beneficiary: "Meta Beneficiary LLC",
    payor: "Meta Payor LLC",
    beneficiarySource: "meta-default",
    payorSource: "meta-default",
    requiredForEurope: true,
});
assert.equal(result.readback.adSets.length, 2);
assert.equal(progress.at(-1).stage, "complete");

const actualCampaign = requests.find((request) => (
    request.method === "post"
    && request.url.endsWith("/act_1/campaigns")
    && !isValidate(request)
));
assert.equal(actualCampaign.data.get("objective"), "OUTCOME_LEADS");
assert.equal(actualCampaign.data.get("status"), "PAUSED");
assert.equal(actualCampaign.data.get("is_adset_budget_sharing_enabled"), "true");

const actualAdSet = requests.find((request) => (
    request.method === "post"
    && request.url.endsWith("/act_1/adsets")
    && !isValidate(request)
));
const targeting = JSON.parse(actualAdSet.data.get("targeting"));
assert.deepEqual(targeting.geo_locations.countries, ["HU", "US"]);
assert.deepEqual(targeting.genders, [2]);
assert.equal(targeting.targeting_automation.advantage_audience, 0);
assert.deepEqual(targeting.device_platforms, ["mobile"]);
assert.deepEqual(targeting.user_os, ["iOS"]);
assert.equal(actualAdSet.data.get("daily_budget"), "500");
assert.equal(actualAdSet.data.has("destination_type"), false);
assert.equal(actualAdSet.data.get("dsa_beneficiary"), "Meta Beneficiary LLC");
assert.equal(actualAdSet.data.get("dsa_payor"), "Meta Payor LLC");
assert.equal(
    JSON.parse(actualAdSet.data.get("promoted_object")).custom_event_type,
    "LEAD"
);

const creative = requests.find((request) => (
    request.method === "post"
    && request.url.endsWith("/act_1/adcreatives")
    && !isValidate(request)
));
const degrees = JSON.parse(creative.data.get("degrees_of_freedom_spec"));
assert.equal(
    degrees.creative_features_spec.standard_enhancements.enroll_status,
    "OPT_OUT"
);
assert.equal(creative.data.get("url_tags"), template.utm);

const postBodies = requests
    .filter((request) => request.method === "post")
    .map((request) => request.data.toString())
    .join("&");
assert.equal(/whatsapp|messaging_destination|wamo_whatsapp_identity_spec/i
    .test(postBodies), false);

const commonPreflightInput = {
    adAccountId: "act_1",
    pageId: "10",
    postId: "20",
    campaignName: "DSA resolution",
    adSetCount: 1,
    dailyBudget: 5,
    startTime: "2026-08-20T10:00:00.000Z",
};
const samePayor = await api.preflightLeadCampaign({
    ...commonPreflightInput,
    template: {
        ...template,
        dsaBeneficiary: "Template Beneficiary LLC",
        dsaPayorSameAsBeneficiary: true,
    },
});
assert.equal(samePayor.dsa.beneficiary, "Template Beneficiary LLC");
assert.equal(samePayor.dsa.payor, "Template Beneficiary LLC");
assert.equal(samePayor.dsa.beneficiarySource, "template");
assert.equal(samePayor.dsa.payorSource, "template");

const separatePayor = await api.preflightLeadCampaign({
    ...commonPreflightInput,
    template: {
        ...template,
        dsaBeneficiary: "Template Beneficiary LLC",
        dsaPayorSameAsBeneficiary: false,
        dsaPayor: "Template Payor LLC",
    },
});
assert.equal(separatePayor.dsa.payor, "Template Payor LLC");
assert.equal(separatePayor.dsa.payorSource, "template");

const nonEuropean = await api.preflightLeadCampaign({
    ...commonPreflightInput,
    template: { ...template, countryCodes: ["US"] },
});
assert.equal(nonEuropean.dsa, null);

accountDsaDefaults = { default_dsa_beneficiary: "Meta Beneficiary LLC" };
await assert.rejects(
    api.preflightLeadCampaign({
        ...commonPreflightInput,
        template: { ...template, dsaBeneficiary: "", dsaPayor: "" },
    }),
    { code: "CAMPAIGN_DSA_PAYOR_REQUIRED" }
);

accountDsaDefaults = {};
await assert.rejects(
    api.preflightLeadCampaign({
        ...commonPreflightInput,
        template: { ...template, dsaBeneficiary: "", dsaPayor: "" },
    }),
    { code: "CAMPAIGN_DSA_BENEFICIARY_REQUIRED" }
);

console.log("Mock-перевірка створення lead-кампанії пройшла успішно");
