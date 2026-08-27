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

await keitaro.cloneCampaign(12, { name: "Copy" });
assert.equal(
    captured.at(-1).url,
    "https://tracker.example.com/admin_api/v1/campaigns/12/clone"
);
assert.equal(captured.at(-1).method, "POST");

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
    httpClient: rateClient,
});
const rateResult = await rateKeitaro.getCampaign(8);
assert.equal(rateResult.ok, true);
assert.equal(rateCalls, 2);

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
