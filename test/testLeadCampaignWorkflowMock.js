import assert from "node:assert/strict";
import createLeadCampaign from "../facebook/workflows/createLeadCampaign.js";
import { buildTargeting, buildAdSetFields, verifyCampaignReadback } from "../facebook/services/campaigns/CampaignSettings.js";


const options = {
    campaignName: "Workflow test",
    adSetCount: 2,
    template: { shareAdSetBudget: false },
    createPaused: false,
    createAdSetsPaused: false,
    createAdsPaused: false,
};

const audienceTemplate = { countryCodes: ["US"], ageMin: 30, ageMax: 50,
    placements: { facebook: ["feed"], instagram: ["stream"] }, advantageAudience: true, minimumAge: 21 };
const advantageTargeting = buildTargeting(audienceTemplate);
assert.equal(advantageTargeting.age_min, 21);
assert.equal(advantageTargeting.age_max, 65);
assert.deepEqual(advantageTargeting.age_range, [30, 50]);
assert.equal(advantageTargeting.targeting_automation.advantage_audience, 1);
const manualTargeting = buildTargeting({ ...audienceTemplate, advantageAudience: false });
assert.equal(manualTargeting.age_min, 30);
assert.equal(manualTargeting.age_max, 50);
assert.ok(!("age_range" in manualTargeting));
assert.equal(manualTargeting.targeting_automation.advantage_audience, 0);
const adSetOptions = { name: "Test", ordinal: "01", campaignId: "1", preflight: {
    pixel: { id: "2" }, targeting: advantageTargeting, dailyBudgetMinor: "500",
} };
assert.deepEqual(buildAdSetFields({ ...adSetOptions, template: audienceTemplate }).placement_soft_opt_out,
    { facebook_positions: ["story", "facebook_reels"], instagram_positions: ["story", "reels"] });
assert.deepEqual(buildAdSetFields({ ...adSetOptions, template: { ...audienceTemplate, allowLimitedPlacementSpend: false } }).placement_soft_opt_out,
    { facebook_positions: [], instagram_positions: [] });
assert.ok(verifyCampaignReadback({ preflight: {}, template: {}, readback: { creative: {}, adSets: [],
    ads: [{ issues_info: [{ error_summary: "Instagram account is missing" }] }],
} }).some((warning) => warning.includes("проблема з Instagram")));

function createOperations({ failSecondAd = false } = {}) {
    const activations = [];
    const writes = [];
    let adSetCount = 0;
    let adCount = 0;
    return {
        activations,
        writes,
        async preflight() {
            return {
                adAccountId: "act_1", pageId: "10", postId: "10_20",
                dailyBudgetMinor: "500", pixel: { id: "30" },
                startTime: "2026-10-06T10:00:00.000Z", targeting: {},
            };
        },
        async createCampaign() {
            writes.push("campaign");
            return { id: "campaign-new" };
        },
        async createCreative(id, fields, settings) {
            if (settings?.validateOnly) return { success: true };
            writes.push("creative");
            return { id: "creative-new" };
        },
        async createAdSet(id, fields, settings) {
            if (settings?.validateOnly) return { success: true };
            writes.push("adset");
            return { id: `adset-${++adSetCount}` };
        },
        async createAd(id, fields, settings) {
            if (settings?.validateOnly) return { success: true };
            writes.push("ad");
            if (failSecondAd && adCount === 1) {
                throw Object.assign(new Error("Невідомий результат запису"), {
                    code: "FACEBOOK_WRITE_OUTCOME_UNKNOWN",
                });
            }
            return { id: `ad-${++adCount}` };
        },
        async activate(id) { activations.push(id); },
        async readback(objects) {
            return {
                campaign: { id: objects.campaignId },
                creative: { id: objects.creativeId },
                adSets: objects.adSets,
                ads: objects.ads,
            };
        },
    };
}

const operations = createOperations();
const instagramFailure = createOperations();
instagramFailure.createCreative = async () => { throw Object.assign(new Error("Instagram account is missing"), {
    code: "FACEBOOK_API_ERROR", graphCode: 100, graphSubcode: 1772103,
}); };
await assert.rejects(createLeadCampaign(options, undefined, instagramFailure), (error) => {
    assert.match(error.message, /Проблема з Instagram/);
    assert.match(error.message, /Use Facebook Page/);
    assert.equal(error.graphSubcode, 1772103);
    assert.equal(error.createdObjects.campaignId, "campaign-new");
    assert.equal(error.stage, "creative");
    return true;
});
assert.deepEqual(instagramFailure.activations, []);
const progress = [];
const result = await createLeadCampaign(options, (event) => progress.push(event), operations);
assert.equal(result.objects.adSets.length, 2);
assert.equal(result.objects.ads.length, 2);
assert.deepEqual(operations.activations, [
    "campaign-new",
]);
assert.equal(progress[0].objects.campaignId, null);
assert.equal(progress[0].objects.adSets.length, 0);
assert.equal(progress.at(-1).stage, "complete");

const failedOperations = createOperations({ failSecondAd: true });
await assert.rejects(
    createLeadCampaign(options, undefined, failedOperations),
    (error) => {
        assert.equal(error.code, "FACEBOOK_WRITE_OUTCOME_UNKNOWN");
        assert.equal(error.stage, "ad");
        assert.equal(error.itemIndex, 1);
        assert.equal(error.createdObjects.campaignId, "campaign-new");
        assert.equal(error.createdObjects.adSets.length, 2);
        assert.equal(error.createdObjects.ads.length, 1);
        return true;
    }
);
assert.deepEqual(failedOperations.activations, []);
assert.deepEqual(failedOperations.writes, ["campaign", "creative", "adset", "ad", "adset", "ad"]);

for (const method of ["createCampaign", "createCreative", "createAdSet", "createAd"]) {
    const broken = createOperations();
    broken[method] = async () => ({ success: true });
    await assert.rejects(createLeadCampaign(options, undefined, broken), { code: "FACEBOOK_WRITE_OUTCOME_UNKNOWN" });
    assert.deepEqual(broken.activations, []);
}
const activationFailure = createOperations();
activationFailure.activate = async () => { throw new Error("Активацію відхилено"); };
await assert.rejects(createLeadCampaign(options, undefined, activationFailure), (error) => {
    assert.equal(error.stage, "activation");
    assert.equal(error.itemIndex, null);
    return true;
});
const dsaWarnings = createOperations();
const dsaPreflight = dsaWarnings.preflight;
dsaWarnings.preflight = async () => ({ ...(await dsaPreflight()), dsa: { beneficiary: "Expected beneficiary", payor: "Expected payor" } });
const dsaResult = await createLeadCampaign(options, undefined, dsaWarnings);
assert.ok(dsaResult.readback.warnings.some((warning) => warning.includes("DSA beneficiary/payor")));
assert.equal(dsaResult.readback.dsaChecks[0].matches, false);
assert.equal(dsaResult.readback.dsaChecks[0].actualBeneficiary, null);
assert.equal(dsaResult.readback.dsaChecks[0].expectedBeneficiary, "Expected beneficiary");

console.log("Перевірка workflow кампанії, активації та часткових помилок пройшла");
