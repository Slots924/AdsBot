import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdSetService from "../services/gui/AdSetService.js";
import RemoteDataCacheStore from "../services/gui/RemoteDataCacheStore.js";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-adset-delivery-"));
try {
    let clock = new Date("2026-11-06T12:00:00Z");
    const now = () => clock;
    const cacheFile = path.join(directory, "cache.json");
    const cache = new RemoteDataCacheStore({ cacheFile, now });
    let countCalls = 0, idCalls = 0, listCalls = 0, statsCalls = 0, fail = false;
    let rows = [{ id: "1", name: "First", status: "ACTIVE", effectiveStatus: "ACTIVE" }, { id: "2", name: "Second", status: "ACTIVE", effectiveStatus: "ACTIVE" }];
    const guiService = {
        async getRejectedAdSetCount() { countCalls++; if (fail) throw new Error("Token expired"); return 2; },
        async getRejectedAdSetIds() { idCalls++; if (fail) throw new Error("Token expired"); return ["1", "2"]; },
        async getCampaignAdSets() { listCalls++; return rows; },
        async getCampaignAdSetInsights() { statsCalls++; return rows.map((row) => ({ adset_id: row.id, spend: "12", actions: [{ action_type: "lead", value: "2" }] })); },
    };
    const create = (store = cache) => new AdSetService({ cache: store, guiService, now, serializeError: (error) => ({ message: error.message }) });
    const service = create();
    const input = { accountKey: "client", adAccountId: "act_1", campaignId: "10", datePreset: "today" };
    const campaigns = [{ id: "10", status: "ACTIVE" }, { id: "20", status: "PAUSED" }];
    await cache.setAdSetSnapshot("act_1", "20", { rejectedCount: 3 });
    assert.equal((await service.enrichCampaigns(input, campaigns))[0].rejectedCount, null);
    await service.refreshRejectedCounts(input, campaigns);
    assert.equal(countCalls, 1);
    assert.deepEqual((await service.enrichCampaigns(input, campaigns)).map((row) => row.rejectedCount), [2, 3]);
    await service.refreshRejectedCounts(input, campaigns);
    assert.equal(countCalls, 1);
    const opened = await service.refresh(input);
    assert.equal(statsCalls, 0);
    assert.equal(idCalls, 1);
    assert.equal(opened.adSets[0].effectiveStatus, "ACTIVE");
    assert.equal(opened.adSets[0].isRejected, true);
    await service.refreshRejectedCounts(input, campaigns);
    assert.equal(countCalls, 1);
    const firstManual = await service.refresh({ ...input, manual: true });
    assert.equal(firstManual.manualRefreshAllowed, true);
    await service.refreshStatistics(input);
    assert.equal(statsCalls, 1);
    const callsBefore = [listCalls, idCalls];
    const tooSoon = await service.refresh({ ...input, manual: true });
    assert.equal(tooSoon.manualRefreshAllowed, false);
    assert.deepEqual([listCalls, idCalls], callsBefore);
    clock = new Date(clock.getTime() + 60_000);
    rows = [...rows, { id: "3", name: "New", status: "ACTIVE", effectiveStatus: "ACTIVE" }];
    await service.refresh({ ...input, manual: true });
    const oldStatistics = await service.refreshStatistics(input);
    assert.equal(statsCalls, 1);
    assert.equal(oldStatistics.adSets.find((row) => row.id === "3").spend, undefined);
    await service.refreshStatistics({ ...input, datePreset: "yesterday" });
    assert.equal(statsCalls, 1);
    clock = new Date(clock.getTime() + 14 * 60_000);
    await service.refresh({ ...input, manual: true });
    const refreshed = await service.refreshStatistics(input);
    assert.equal(statsCalls, 2);
    assert.equal(refreshed.adSets.find((row) => row.id === "3").spend, 12);
    fail = true;
    clock = new Date(clock.getTime() + 60_000);
    const failedIds = await service.refresh(input);
    assert.equal(failedIds.adSets[0].isRejected, true);
    assert.equal(failedIds.adSets[0].spend, 12);
    await service.refreshRejectedCounts(input, campaigns);
    assert.equal((await service.enrichCampaigns(input, campaigns))[0].rejectedCount, 2);
    const restarted = create(new RemoteDataCacheStore({ cacheFile, now }));
    const calls = [listCalls, idCalls, countCalls];
    await restarted.refresh(input);
    await restarted.refreshRejectedCounts(input, campaigns);
    assert.deepEqual([listCalls, idCalls, countCalls], calls);
    assert.equal((await restarted.read(input)).adSets[0].isRejected, true);

    const requests = [];
    let missingSummary = false;
    const api = new FacebookGraphApi({ accountKey: "mock", accessToken: "mock", cookie: "mock", userAgent: "mock", proxyHttpClient: {
        async request(request) {
            requests.push(request);
            if (request.params.limit === 0) return { data: { data: [], ...(missingSummary ? {} : { summary: { total_count: 2 } }) } };
            return { data: request.params.after ? { data: [{ id: "2" }] } : { data: [{ id: "1" }], paging: { next: "next", cursors: { after: "second" } } } };
        },
    } });
    assert.equal(await api.getRejectedAdSetCount("act_1", "10"), 2);
    assert.equal(requests[0].params.fields, "id");
    assert.equal(requests[0].params.limit, 0);
    assert.equal(requests[0].params.summary, "total_count");
    assert.deepEqual(JSON.parse(requests[0].params.filtering), [{ field: "campaign.id", operator: "IN", value: ["10"] }, { field: "adset.delivery_info", operator: "IN", value: ["rejected"] }]);
    assert.deepEqual(await api.getRejectedAdSetIds("act_1", "10"), ["1", "2"]);
    missingSummary = true;
    await assert.rejects(() => api.getRejectedAdSetCount("act_1", "10"), { code: "ADSET_REJECTED_COUNT_INVALID" });
    console.log("Rejected: мінімальний summary, ID, кеш та інтервали 1/15 хв — OK");
} finally { await rm(directory, { recursive: true, force: true }); }
