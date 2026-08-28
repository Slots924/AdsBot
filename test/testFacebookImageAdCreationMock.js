import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import FacebookBackendService
    from "../facebook/services/FacebookBackendService.js";


const requests = [];
let backendCampaignOptions = null;
const backend = await FacebookBackendService.create({
    facebookApiClients: new Map([["client", {
        async createLeadCampaign(options) {
            backendCampaignOptions = options;
            return { objects: {} };
        },
    }]]),
    creativeManager: {
        async getCreative() {
            return {
                creative: "\nЗаголовок <LINK>\n\nАбзац 1\n\nАбзац 2",
                comments: [],
            };
        },
    },
    imageLoader: async () => ({
        buffer: Buffer.from("image"),
        filename: "creative.jpg",
        contentType: "image/jpeg",
    }),
});
await backend.createLeadCampaign("client", {
    creativeMode: "image",
    geo: "HU",
    creativeName: "17",
    siteUrl: "https://offer.example/path",
    imagePath: "C:/creative.jpg",
});
assert.equal(
    backendCampaignOptions.adCreative.headline,
    "Заголовок https://offer.example/path"
);
assert.equal(
    backendCampaignOptions.adCreative.primaryText,
    "Абзац 1\n\nАбзац 2"
);

const api = new FacebookGraphApi({
    accountKey: "client",
    accessToken: "secret",
    cookie: "cookie",
    userAgent: "agent",
    proxyHttpClient: {
        async request(config) {
            requests.push(config);
            const pathname = new URL(config.url).pathname.replace("/v26.0", "");
            const validateOnly = config.data instanceof URLSearchParams
                && config.data.has("execution_options");
            if (pathname === "/me/permissions") {
                return { data: { data: [{
                    permission: "ads_management",
                    status: "granted",
                }] } };
            }
            if (pathname === "/act_1" && config.method === "get") {
                return { data: {
                    id: "act_1",
                    name: "Account",
                    account_status: 1,
                    currency: "USD",
                    timezone_name: "Europe/Kyiv",
                } };
            }
            if (pathname === "/me/accounts") {
                return { data: { data: [{
                    id: "10",
                    name: "Page",
                    tasks: ["CREATE_CONTENT", "ADVERTISE"],
                    access_token: "page-token",
                }] } };
            }
            if (pathname === "/10") {
                return { data: { id: "10", name: "Page", is_published: true } };
            }
            if (pathname === "/act_1/adspixels") {
                return { data: { data: [{ id: "30", name: "Pixel" }] } };
            }
            if (validateOnly) return { data: { success: true } };
            if (pathname === "/act_1/campaigns" && config.method === "post") {
                return { data: { id: "campaign-image" } };
            }
            if (pathname === "/act_1/adimages" && config.method === "post") {
                assert.ok(config.data instanceof FormData);
                return { data: { images: { "creative.jpg": {
                    hash: "image-hash",
                } } } };
            }
            if (pathname === "/act_1/adcreatives" && config.method === "post") {
                return { data: { id: "creative-image" } };
            }
            if (pathname === "/act_1/adsets" && config.method === "post") {
                return { data: { id: "adset-image" } };
            }
            if (pathname === "/act_1/ads" && config.method === "post") {
                return { data: { id: "ad-image" } };
            }
            if (pathname === "/campaign-image") {
                return { data: { id: "campaign-image", status: "PAUSED" } };
            }
            if (pathname === "/creative-image") {
                return { data: {
                    id: "creative-image",
                    degrees_of_freedom_spec: {
                        creative_features_spec: {
                            standard_enhancements: {
                                enroll_status: "OPT_OUT",
                            },
                        },
                    },
                } };
            }
            if (pathname === "/adset-image") {
                return { data: { id: "adset-image", status: "PAUSED" } };
            }
            if (pathname === "/ad-image") {
                return { data: { id: "ad-image", status: "PAUSED" } };
            }
            throw new Error(`Неочікуваний mock-запит: ${config.method} ${pathname}`);
        },
    },
});

const template = {
    countryCodes: ["HU"],
    gender: "all",
    ageMin: 18,
    ageMax: 65,
    devicePlatforms: [],
    operatingSystems: [],
    placements: { facebook: ["feed"], instagram: [] },
    shareAdSetBudget: false,
    dsaBeneficiary: "Beneficiary LLC",
    dsaPayorSameAsBeneficiary: true,
};
const result = await api.createLeadCampaign({
    adAccountId: "act_1",
    pageId: "10",
    template,
    pixelId: "30",
    campaignName: "HU | Creo_17 | 18+",
    adSetCount: 1,
    dailyBudget: 5,
    startTime: "2026-08-28T10:00:00.000Z",
    creativeMode: "image",
    siteUrl: "https://offer.example/path",
    utm: "utm_source=facebook",
    createPaused: true,
    createAdSetsPaused: false,
    createAdsPaused: true,
    adCreative: {
        headline: "Перший рядок",
        primaryText: "Другий рядок\nТретій рядок",
        siteUrl: "https://offer.example/path",
        callToActionType: "NO_BUTTON",
        image: {
            buffer: Buffer.from("image"),
            filename: "creative.jpg",
            contentType: "image/jpeg",
        },
    },
});

assert.equal(result.objects.campaignId, "campaign-image");
const creativeRequest = requests.find((request) => (
    request.method === "post"
    && request.url.endsWith("/act_1/adcreatives")
    && request.data instanceof URLSearchParams
    && !request.data.has("execution_options")
));
const story = JSON.parse(creativeRequest.data.get("object_story_spec"));
assert.equal(story.page_id, "10");
assert.equal(story.link_data.image_hash, "image-hash");
assert.equal(story.link_data.link, "https://offer.example/path");
assert.equal(story.link_data.name, "Перший рядок");
assert.equal(story.link_data.message, "Другий рядок\nТретій рядок");
assert.equal("call_to_action" in story.link_data, false);
assert.equal(creativeRequest.data.get("url_tags"), "utm_source=facebook");
const activationPaths = requests
    .filter((request) => (
        request.method === "post"
        && ["/campaign-image", "/adset-image", "/ad-image"].includes(
            new URL(request.url).pathname.replace("/v26.0", "")
        )
    ))
    .map((request) => new URL(request.url).pathname.replace("/v26.0", ""));
assert.deepEqual(activationPaths, ["/adset-image"]);

console.log("Mock-перевірка рекламного оголошення із зображенням пройшла успішно");
