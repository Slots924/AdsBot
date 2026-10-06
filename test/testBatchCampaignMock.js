import assert from "node:assert/strict";
import preflightLeadCampaign from "../facebook/workflows/preflightLeadCampaign.js";
import createLeadCampaign from "../facebook/workflows/createLeadCampaign.js";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";

const input = {
    adAccountId: "act_1", campaignName: "DE CBO", pixelId: "30",
    posts: [{ pageId: "10", postId: "10_20" }, { pageId: "11", postId: "11_21" }],
    adSetCount: 2, dailyBudget: 5, campaignBudget: 27.5,
    budgetMode: "campaign", startTime: "2026-10-07T10:00:00Z",
    template: { countryCodes: ["US"], ageMin: 18, ageMax: 65, placements: { facebook: ["feed"], instagram: ["stream"] }, shareAdSetBudget: true },
};
const checkedPosts = [];
const validatedCampaigns = [];
const operations = {
    getPermissions: async () => ({ granted: ["ads_management"] }),
    getAccount: async () => ({ account_status: 1, currency: "USD" }),
    getPage: async (id) => ({ id, name: id, pageAccessToken: `token-${id}` }),
    getPost: async (id) => { checkedPosts.push(id); return { message: "https://example.test", is_published: true }; },
    getPixels: async () => [{ id: "30" }],
    getInstagramAccount: async (id) => ({ instagram_business_account: { id: `ig-${id}` } }),
    validateCampaign: async (id, fields) => { validatedCampaigns.push(fields); },
};
const preflight = await preflightLeadCampaign(input, operations);
assert.deepEqual(checkedPosts, ["10_20", "11_21"]);
assert.equal(validatedCampaigns.length, 1);
assert.equal(validatedCampaigns[0].daily_budget, "2750");
assert.equal(validatedCampaigns[0].is_adset_budget_sharing_enabled, false);
assert.equal(preflight.posts[1].instagramActorId, "ig-11");

for (const budgetMode of ["adset", "campaign"]) {
    const writes = { campaign: [], creative: [], adset: [], ad: [] };
    const activations = [];
    const writer = (kind) => async (id, fields, settings) => {
        if (settings?.validateOnly) return { success: true };
        writes[kind].push(fields);
        return { id: `${kind}-${writes[kind].length}` };
    };
    const result = await createLeadCampaign({ ...input, budgetMode, createPaused: false, createAdSetsPaused: false, createAdsPaused: false }, undefined, {
        preflight: (options) => preflightLeadCampaign(options, operations),
        createCampaign: writer("campaign"), createCreative: writer("creative"),
        createAdSet: writer("adset"), createAd: writer("ad"),
        activate: async (id) => activations.push(id),
        readback: async (objects) => ({ creative: {}, adSets: objects.adSets }),
    });
    assert.equal(result.objects.creatives.length, 2);
    assert.equal(result.objects.ads.length, 4);
    assert.deepEqual(writes.creative.map((fields) => fields.object_story_id), ["10_20", "11_21"]);
    assert.deepEqual(writes.creative.map((fields) => fields.instagram_actor_id), ["ig-10", "ig-11"]);
    assert.deepEqual(writes.ad.map((fields) => [fields.adset_id, fields.creative.creative_id]), [
        ["adset-1", "creative-1"], ["adset-1", "creative-2"],
        ["adset-2", "creative-1"], ["adset-2", "creative-2"],
    ]);
    assert.deepEqual(activations, ["ad-1", "ad-2", "ad-3", "ad-4", "adset-1", "adset-2", "campaign-1"]);
    if (budgetMode === "campaign") {
        assert.equal(writes.campaign[0].daily_budget, "2750");
        assert.equal(writes.campaign[0].is_adset_budget_sharing_enabled, false);
        assert.ok(writes.adset.every((fields) => !("daily_budget" in fields) && !("bid_strategy" in fields)));
    } else {
        assert.ok(!("daily_budget" in writes.campaign[0]));
        assert.equal(writes.campaign[0].is_adset_budget_sharing_enabled, true);
        assert.ok(writes.adset.every((fields) => fields.daily_budget === "500"));
    }
}
await assert.rejects(preflightLeadCampaign({ ...input, posts: [] }, operations), { code: "CAMPAIGN_POSTS_INVALID" });
await assert.rejects(preflightLeadCampaign({ ...input, posts: [input.posts[0], input.posts[0]] }, operations), { code: "CAMPAIGN_POSTS_DUPLICATE" });
let campaignWrites = 0;
await assert.rejects(createLeadCampaign(input, undefined, {
    preflight: (options) => preflightLeadCampaign(options, { ...operations, getPost: async (id) => ({ message: id === "10_20" ? "https://example.test" : "Без URL" }) }),
    createCampaign: async () => { campaignWrites += 1; },
}), { code: "CAMPAIGN_POST_WEBSITE_URL_REQUIRED" });
assert.equal(campaignWrites, 0);

let createdCreatives = 0;
let createdAds = 0;
let activated = false;
await assert.rejects(createLeadCampaign({ ...input, createPaused: false }, undefined, {
    preflight: () => preflight,
    createCampaign: async () => ({ id: "campaign" }),
    createCreative: async (id, fields, settings) => settings?.validateOnly ? {} : { id: `creative-${++createdCreatives}` },
    createAdSet: async () => ({ id: "adset" }),
    createAd: async (id, fields, settings) => {
        if (settings?.validateOnly) return {};
        if (++createdAds === 2) throw new Error("Помилка другого оголошення");
        return { id: "ad-1" };
    },
    activate: async () => { activated = true; },
}), (error) => {
    assert.equal(error.stage, "ad");
    assert.equal(error.createdObjects.creatives.length, 2);
    assert.equal(error.createdObjects.ads.length, 1);
    return true;
});
assert.equal(activated, false);

const removed = [];
const api = new FacebookGraphApi({ accountKey: "test", accessToken: "mock", proxyHttpClient: {
    request: async (config) => { removed.push(new URL(config.url).pathname.split("/").at(-1)); return { data: { success: true } }; },
} });
await api.deleteCampaignDraft({ campaignId: "campaign", creativeId: "creative-1", creatives: [{ id: "creative-1" }, { id: "creative-2" }], ads: [{ id: "ad" }], adSets: [{ id: "adset" }] });
assert.deepEqual(removed, ["ad", "adset", "creative-1", "creative-2", "campaign"]);
console.log("Масовий запуск: усі пости, ABO/CBO, Instagram, перевірки та очищення пройшли");
