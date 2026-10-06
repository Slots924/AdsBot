import assert from "node:assert/strict";
import createLeadCampaign from "../facebook/workflows/createLeadCampaign.js";


const options = {
    campaignName: "Workflow test",
    adSetCount: 2,
    template: { shareAdSetBudget: false },
    createPaused: false,
    createAdSetsPaused: false,
    createAdsPaused: false,
};

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
const progress = [];
const result = await createLeadCampaign(options, (event) => progress.push(event), operations);
assert.equal(result.objects.adSets.length, 2);
assert.equal(result.objects.ads.length, 2);
assert.deepEqual(operations.activations, [
    "ad-1", "ad-2", "adset-1", "adset-2", "campaign-new",
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

console.log("Перевірка workflow кампанії, активації та часткових помилок пройшла");
