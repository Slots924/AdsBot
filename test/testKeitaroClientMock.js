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

assert.throws(() => keitaro.getCampaign(""), /ID кампанії/);
assert.throws(() => keitaro.buildReport(null), /звіт/);

const emptyClient = new Keitaro({ apiKey: "", apiUrl: "", httpClient });
await assert.rejects(() => emptyClient.listCampaigns(), /KEITARO_API_URL|KEITARO_API_KEY/);

assert.equal(normalizeState({}).activeTab, "accounts");
assert.equal(normalizeState({ activeTab: "keitaro" }).activeTab, "keitaro");
assert.deepEqual(normalizeState({}).keitaroAvailableGroupIds, []);
assert.equal(normalizeState({}).keitaroGroupId, "all");
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
