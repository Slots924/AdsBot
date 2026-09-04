import assert from "node:assert/strict";

import Keitaro from "../classes/Keitaro.js";
import { normalizeState } from "../services/gui/AppStateStore.js";


const captured = [];
const httpClient = {
    async request(config) {
        captured.push(config);
        if (String(config.url).endsWith("/broken")) {
            const error = new Error("fail");
            error.response = { status: 500, data: { error: "Трекер зайнятий" } };
            throw error;
        }
        if (config.method === "GET" && String(config.url).endsWith("/campaigns")) {
            return { status: 200, data: [{ id: 1, name: "Offer 1" }] };
        }
        if (config.method === "GET" && String(config.url).endsWith("/offers")) {
            return { status: 200, data: [{ id: 21, name: "Offer 21" }] };
        }
        if (config.method === "GET" && String(config.url).endsWith("/landing_pages")) {
            return { status: 200, data: [{ id: 68, name: "Landing 68" }] };
        }
        if (config.method === "GET" && /\/campaigns\/\d+\/streams$/.test(String(config.url))) {
            const campaignId = Number(String(config.url).match(/campaigns\/(\d+)/)?.[1]);
            return { status: 200, data: [{ id: campaignId * 100, position: 1, name: "AT OFFERS" }] };
        }
        if (config.method === "GET" && String(config.url).endsWith("/streams/search")) {
            assert.equal(config.params.query, "AT OFFERS");
            return { status: 200, data: [
                { id: 100, name: "AT OFFERS" },
                { id: 101, name: "AT OFFERS backup" },
            ] };
        }
        if (config.method === "GET" && String(config.url).endsWith("/stream_filters")) {
            return { status: 200, data: [{ value: "country" }] };
        }
        return { status: 200, data: { ok: true, id: 7 } };
    },
};

const keitaro = new Keitaro({
    apiKey: "TEST_KEITARO_KEY",
    apiUrl: "https://tracker.example.com/admin_api/v1",
    httpClient,
});

const campaigns = await keitaro.listCampaigns({ limit: 50 });
assert.deepEqual(campaigns, [{ id: 1, name: "Offer 1" }]);
assert.equal(captured[0].method, "GET");
assert.equal(captured[0].url, "https://tracker.example.com/admin_api/v1/campaigns");
assert.equal(captured[0].headers["Api-Key"], "TEST_KEITARO_KEY");
assert.equal(captured[0].params.limit, 50);

const offers = await keitaro.listAllOffers();
const landings = await keitaro.listAllLandings();
assert.deepEqual(offers, [{ id: 21, name: "Offer 21" }]);
assert.deepEqual(landings, [{ id: 68, name: "Landing 68" }]);
assert.equal(captured.at(-2).params.limit, undefined);
assert.equal(captured.at(-2).params.offset, undefined);
assert.equal(captured.at(-1).params.limit, undefined);
assert.equal(captured.at(-1).params.offset, undefined);

await keitaro.listCampaignGroups();
assert.equal(captured.at(-1).url, "https://tracker.example.com/admin_api/v1/groups");
assert.equal(captured.at(-1).params.type, "campaigns");

await keitaro.sendBatch([
    { method: "PUT", path: "campaigns/72", params: { name: "A" } },
    { method: "PUT", path: "campaigns/73", params: { name: "B" } },
]);
assert.equal(captured.at(-1).url, "https://tracker.example.com/admin_api/v1/?batch");
assert.equal(captured.at(-1).method, "POST");
assert.equal(captured.at(-1).data.length, 2);

const addedStreams = await keitaro.applyStreamTemplateToCampaigns({
    campaignIds: [11, 12],
    stream: {
        id: 423,
        name: "White",
        position: 1,
        filters: [{ id: 821, stream_id: 423, oid: 821, name: "country", mode: "reject", payload: ["JP"] }],
        landings: [{ landing_id: 68, name: "White [JP]", share: 100 }],
        offers: [],
    },
});
assert.equal(addedStreams.every((item) => item.ok), true);
const createRequests = captured.filter((item) => item.method === "POST" && item.url.endsWith("/streams"));
assert.deepEqual(createRequests.slice(-2).map((item) => item.data.campaign_id), [11, 12]);
assert.equal("position" in createRequests.at(-1).data, false);
assert.deepEqual(createRequests.at(-1).data.landings, [{
    landing_id: 68,
    share: 100,
    state: "active",
}]);
assert.deepEqual(createRequests.at(-1).data.filters, [{
    name: "country",
    mode: "reject",
    payload: ["JP"],
}]);

const replacedStreams = await keitaro.applyStreamTemplateToCampaigns({
    campaignIds: [11, 12],
    stream: { name: "Black", landings: [], offers: [] },
    mode: "replace",
    replacePosition: 1,
});
assert.equal(replacedStreams.every((item) => item.ok), true);
const updateRequests = captured.filter((item) => item.method === "PUT" && /\/streams\/\d+$/.test(item.url));
assert.deepEqual(updateRequests.slice(-2).map((item) => item.url.split("/").at(-1)), ["1100", "1200"]);
const appliedToMatching = await keitaro.applyStreamTemplateToMatchingStreams({
    streamName: "AT OFFERS",
    stream: { name: "AT OFFERS", landings: [], offers: [] },
});
assert.equal(appliedToMatching.matched, 1);
assert.equal(appliedToMatching.updated, 1);
assert.equal(appliedToMatching.failed, 0);
const matchingUpdates = captured.filter((item) => item.method === "PUT" && /\/streams\/100$/.test(item.url));
assert.deepEqual(matchingUpdates.map((item) => item.data.name), ["AT OFFERS"]);
assert.equal("campaign_id" in matchingUpdates[0].data, false);
assert.equal("position" in matchingUpdates[0].data, false);
assert.deepEqual(await keitaro.listStreamFilters(), [{ value: "country" }]);
await keitaro.cloneCampaign(12, { name: "Copy" });
assert.equal(
    captured.at(-1).url,
    "https://tracker.example.com/admin_api/v1/campaigns/12/clone"
);
assert.equal(captured.at(-1).method, "POST");

const movedCampaigns = await keitaro.moveCampaignsToGroup([12, 13], 20);
assert.equal(movedCampaigns.every((item) => item.ok), true);
assert.deepEqual(captured.slice(-2).map((item) => item.data.group_id), [20, 20]);
const movedOffers = await keitaro.moveOffersToGroup([21, 22], 36);
assert.equal(movedOffers.every((item) => item.ok), true);
assert.deepEqual(captured.slice(-2).map((item) => item.data.group_id), [36, 36]);

await keitaro.buildReport({
    range: { from: "2026-08-01", to: "2026-08-27" },
    dimensions: ["campaign_id"],
    metrics: ["clicks"],
});
assert.equal(
    captured.at(-1).url,
    "https://tracker.example.com/admin_api/v1/report/build"
);

await assert.rejects(
    () => keitaro.request("GET", "/broken"),
    /Трекер зайнятий/
);
const restored = await keitaro.restoreCampaign(3);
assert.equal(restored.ok, true);
assert.equal(
    captured.at(-1).url,
    "https://tracker.example.com/admin_api/v1/campaigns/3/restore"
);

assert.throws(() => keitaro.sendBatch([]), /batch/);
assert.throws(() => keitaro.getCampaign(""), /ID кампанії/);
assert.throws(() => keitaro.buildReport(null), /звіт/);

const emptyClient = new Keitaro({ apiKey: "", apiUrl: "", httpClient });
await assert.rejects(() => emptyClient.listCampaigns(), /KEITARO_API_URL|KEITARO_API_KEY/);

assert.equal(normalizeState({}).activeTab, "accounts");
assert.equal(normalizeState({ activeTab: "keitaro" }).activeTab, "keitaro");
assert.deepEqual(normalizeState({}).keitaroAvailableGroupIds, []);
assert.equal(normalizeState({}).keitaroGroupId, "all");
assert.equal(normalizeState({ keitaroSubtab: "offers" }).keitaroSubtab, "offers");
assert.equal(normalizeState({ keitaroOffersGrouped: true }).keitaroOffersGrouped, true);
assert.equal(normalizeState({ keitaroPageSize: 500 }).keitaroPageSize, 500);
let inflight = 0;
let maxInflight = 0;
const limitedClient = {
    async request() {
        inflight += 1;
        maxInflight = Math.max(maxInflight, inflight);
        await new Promise((resolve) => setTimeout(resolve, 40));
        inflight -= 1;
        return { status: 200, data: { ok: true } };
    },
};
const limitedKeitaro = new Keitaro({
    apiKey: "TEST_KEITARO_KEY",
    apiUrl: "https://tracker.example.com",
    concurrency: 2,
    httpClient: limitedClient,
});
await Promise.all([
    limitedKeitaro.getCampaign(1),
    limitedKeitaro.getCampaign(2),
    limitedKeitaro.getCampaign(3),
]);
assert.equal(maxInflight, 2);
assert.equal(limitedKeitaro.setConcurrency(99), 50);
assert.equal(limitedKeitaro.setConcurrency(0), 1);

let rateCalls = 0;
const rateClient = {
    async request() {
        rateCalls += 1;
        if (rateCalls === 1) {
            const error = new Error("Too Many Requests");
            error.response = {
                status: 429,
                headers: { "retry-after": "0" },
                data: { error: "Too Many Requests" },
            };
            throw error;
        }
        return { status: 200, data: { ok: true } };
    },
};
const rateKeitaro = new Keitaro({
    apiKey: "TEST_KEITARO_KEY",
    apiUrl: "https://tracker.example.com",
    retryOnRateLimit: true,
    httpClient: rateClient,
});
const rateResult = await rateKeitaro.getCampaign(8);
assert.equal(rateResult.ok, true);
assert.equal(rateCalls, 2);

let skipCalls = 0;
const skipClient = {
    async request() {
        skipCalls += 1;
        const error = new Error("Too Many Requests");
        error.response = { status: 429, data: { error: "Too Many Requests" } };
        throw error;
    },
};
const skipKeitaro = new Keitaro({
    apiKey: "TEST_KEITARO_KEY",
    apiUrl: "https://tracker.example.com",
    httpClient: skipClient,
});
await assert.rejects(() => skipKeitaro.getCampaign(9), /Too Many Requests/);
assert.equal(skipCalls, 1);

assert.equal(normalizeState({}).keitaroConcurrency, 20);
assert.equal(normalizeState({ keitaroConcurrency: 8 }).keitaroConcurrency, 8);
assert.equal(normalizeState({ keitaroConcurrency: 99 }).keitaroConcurrency, 50);
assert.equal(normalizeState({}).keitaroPageSize, 50);
assert.equal(normalizeState({ keitaroPageSize: 150 }).keitaroPageSize, 150);
assert.equal(normalizeState({ keitaroPageSize: 12 }).keitaroPageSize, 50);
assert.equal(normalizeState({ keitaroDatePreset: "broken" }).keitaroDatePreset, "today");
assert.deepEqual(
    normalizeState({ keitaroVisibleColumns: ["clicks", "nope"] }).keitaroVisibleColumns,
    ["clicks"]
);
assert.equal(
    normalizeState({ keitaroColumnWidths: { clicks: 30 } }).keitaroColumnWidths.clicks,
    64
);

console.log("Перевірка класу Keitaro пройшла успішно");
