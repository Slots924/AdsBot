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
        async getRejectedAdSets() { countCalls++; if (fail) throw new Error("Token expired"); return [{ id: "1", campaignId: "10" }, { id: "2", campaignId: "10" }, { id: "2", campaignId: "10" }, { id: "4", campaignId: "20" }, { id: "5", campaignId: "99" }]; },
        async getRejectedAdSetIds() { idCalls++; if (fail) throw new Error("Token expired"); return ["1", "2"]; },
        async getCampaignAdSets() { listCalls++; return rows; },
        async getCampaignAdSetInsights() { statsCalls++; return rows.map((row) => ({ adset_id: row.id, spend: "12", actions: [{ action_type: "lead", value: "2" }] })); },
    };
    const create = (store = cache) => new AdSetService({ cache: store, guiService, now, serializeError: (error) => ({ message: error.message }) });
    const service = create();
    const input = { accountKey: "client", adAccountId: "act_1", campaignId: "10", datePreset: "today" };
    const campaigns = [{ id: "10", status: "ACTIVE" }, { id: "20", status: "PAUSED" }, { id: "30", status: "PAUSED" }];
    await cache.setAdSetSnapshot("act_1", "10", { rejectedCount: 3, rejectedIds: ["1"], rejectedIdsError: { message: "Old error" } });
    guiService.getRejectedAdSetCount = async () => { countCalls++; if (fail) throw new Error("Token expired"); return 2; };
    assert.equal((await service.enrichCampaigns(input, campaigns))[0].rejectedCount, 3);
    const opened = await service.refresh(input);
    assert.equal(opened.adSets[0].isRejected, undefined);
    assert.equal(opened.refreshError, null);
    assert.deepEqual([countCalls, idCalls, statsCalls], [0, 0, 0]);
    await service.refreshStatistics(input);
    assert.equal(statsCalls, 1);
    const first = await service.refreshRejectedCount(input);
    assert.equal(first.rejectedCount, 2);
    assert.equal(first.skipped, false);
    assert.equal((await service.refreshRejectedCount(input)).skipped, true);
    assert.equal(countCalls, 1);
    const restarted = create(new RemoteDataCacheStore({ cacheFile, now }));
    assert.equal((await restarted.refreshRejectedCount(input)).skipped, true);
    assert.equal(countCalls, 1);
    await service.refreshRejectedCount({ ...input, campaignId: "20" });
    assert.equal(countCalls, 2);
    clock = new Date(clock.getTime() + 60_000);
    await Promise.all([service.refreshRejectedCount(input), service.refreshRejectedCount(input)]);
    assert.equal(countCalls, 3);
    fail = true;
    clock = new Date(clock.getTime() + 60_000);
    const failed = await service.refreshRejectedCount(input);
    assert.equal(failed.rejectedCount, 2);
    assert.ok(failed.rejectedCountError);
    await service.refreshRejectedCount(input);
    assert.equal(countCalls, 4);
    fail = false;
    guiService.getRejectedAdSetCount = async () => { countCalls++; return 0; };
    clock = new Date(clock.getTime() + 60_000);
    assert.equal((await service.refreshRejectedCount(input)).rejectedCount, 0);
    await service.refresh({ ...input, manual: true });
    await service.refreshStatistics(input);
    assert.equal(statsCalls, 1);
    assert.equal(idCalls, 0);

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
    let invalidCampaign = false, incomplete = false;
    const accountRequests = [];
    const accountApi = new FacebookGraphApi({ accountKey: "mock", accessToken: "mock", cookie: "mock", userAgent: "mock", proxyHttpClient: {
        async request(request) {
            accountRequests.push(request);
            return { data: request.params.after
                ? { data: [{ id: "1", campaign_id: "10" }, { id: "2", ...(invalidCampaign ? {} : { campaign_id: "20" }) }] }
                : { data: [{ id: "1", campaign_id: "10" }], paging: { next: "next", ...(incomplete ? {} : { cursors: { after: "second" } }) } } };
        },
    } });
    assert.deepEqual(await accountApi.getRejectedAdSets("act_1"), [{ id: "1", campaignId: "10" }, { id: "2", campaignId: "20" }]);
    assert.equal(accountRequests.length, 2);
    assert.ok(accountRequests[0].url.endsWith("/act_1/adsets"));
    assert.equal(accountRequests[0].params.fields, "id,campaign_id");
    assert.deepEqual(JSON.parse(accountRequests[0].params.filtering), [{ field: "adset.delivery_info", operator: "IN", value: ["rejected"] }]);
    invalidCampaign = true;
    await assert.rejects(() => accountApi.getRejectedAdSets("act_1"), { code: "ADSET_REJECTED_CAMPAIGN_INVALID" });
    incomplete = true;
    await assert.rejects(() => accountApi.getRejectedAdSets("act_1"), { code: "FACEBOOK_CAMPAIGN_LIST_INCOMPLETE" });
    console.log("Rejected: ручна кнопка, кеш, незалежні інтервали та відсутність автоматичних запитів — OK");
} finally { await rm(directory, { recursive: true, force: true }); }
