import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdSetService from "../services/gui/AdSetService.js";
import RemoteDataCacheStore from "../services/gui/RemoteDataCacheStore.js";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import { localValueInZone, zonedValueToIso } from "../frontend/src/lib/accountTime.js";

const refreshAll = async (service, input) => { await service.refresh(input); return service.refreshStatistics(input); };

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-adsets-"));
try {
    const cacheFile = path.join(directory, "cache.json");
    let clock = new Date("2026-11-06T10:00:00Z");
    let listCalls = 0, statCalls = 0, fail = false, failStats = false, empty = false;
    const guiService = {
        async getCampaignAdSets() { listCalls++; if (fail) throw new Error("Токен недійсний"); return empty ? [] : [{ id: "10", name: "Адсет", effectiveStatus: "ACTIVE" }]; },
        async getCampaignAdSetInsights() { statCalls++; if (failStats) throw new Error("Статистика недоступна"); return [{ adset_id: "10", spend: "12", impressions: "1000", clicks: "20", actions: [{ action_type: "lead", value: "3" }] }]; },
        async duplicateAdSet() { return { copies: [{ id: "11", name: "Копія", status: "ACTIVE" }] }; },
        async deleteAdSet(_accountKey, input) { return { id: input.adSetId, status: "DELETED", effectiveStatus: "DELETED" }; },
    };
    const cache = new RemoteDataCacheStore({ cacheFile, now: () => clock });
    await cache.setWorkspacePart("client", { adAccounts: [{ id: "act_1", timezoneName: "America/Los_Angeles" }] });
    const create = (store = cache) => new AdSetService({ cache: store, guiService, now: () => clock, serializeError: (error) => ({ message: error.message }) });
    const service = create();
    const input = { accountKey: "client", adAccountId: "act_1", campaignId: "20", datePreset: "today" };
    assert.equal((await service.read(input)).cacheHit, false);
    const results = await Promise.all([refreshAll(service, input), refreshAll(service, input), refreshAll(service, input)]);
    assert.equal(listCalls, 1); assert.equal(statCalls, 1);
    assert.equal(results[0].adSets[0].costPerLead, 4);
    assert.equal(results[0].context.timeZone, "America/Los_Angeles");
    clock = new Date(clock.getTime() + 60_000);
    await refreshAll(service, input);
    assert.equal(listCalls, 2); assert.equal(statCalls, 1);
    clock = new Date(clock.getTime() + 14 * 60_000);
    await refreshAll(service, input);
    assert.equal(listCalls, 3); assert.equal(statCalls, 2);
    fail = true; clock = new Date(clock.getTime() + 60_000);
    const failed = await refreshAll(service, input);
    assert.equal(failed.adSets[0].spend, 12);
    assert.match(failed.refreshError.message, /Токен/);
    const restarted = create(new RemoteDataCacheStore({ cacheFile, now: () => clock }));
    assert.equal((await restarted.read(input)).adSets[0].leads, 3);
    await refreshAll(restarted, input); assert.equal(listCalls, 4);
    const other = await restarted.read({ ...input, accountKey: "another-client", datePreset: "yesterday" });
    assert.equal(other.adSets[0].spend, 12); assert.equal(other.statisticsStale, true);
    fail = false; failStats = true; clock = new Date(clock.getTime() + 15 * 60_000);
    const statsFailed = await refreshAll(restarted, input);
    assert.equal(statsFailed.adSets[0].leads, 3); assert.match(statsFailed.refreshError.message, /Статистика/);
    await refreshAll(restarted, input); assert.equal(statCalls, 3);
    empty = true; clock = new Date(clock.getTime() + 60_000);
    assert.equal((await refreshAll(restarted, input)).adSets[0].missingFromLatestRead, true);
    await restarted.duplicate(input);
    assert.equal((await restarted.read(input)).adSets.length, 2);
    const deleted = await restarted.delete({ ...input, adSetId: "11" });
    assert.equal(deleted.data.adSets.find((row) => row.id === "11").status, "DELETED");
    assert.equal(deleted.data.adSets.find((row) => row.id === "11").spend, null);
    const afterDelete = create(new RemoteDataCacheStore({ cacheFile, now: () => clock }));
    assert.equal((await afterDelete.read(input)).adSets.find((row) => row.id === "11").status, "DELETED");
    const originalList = guiService.getCampaignAdSets;
    guiService.getCampaignAdSets = async () => [{ id: "11", name: "Копія", status: "ACTIVE", effectiveStatus: "ACTIVE" }];
    clock = new Date(clock.getTime() + 60_000);
    assert.equal((await afterDelete.refresh(input)).adSets.find((row) => row.id === "11").status, "DELETED");
    guiService.getCampaignAdSets = originalList;

    const order = [];
    let releaseStatistics;
    const blockedStatistics = new Promise((resolve) => { releaseStatistics = resolve; });
    const prioritized = new AdSetService({ cache, now: () => clock, serializeError: (error) => ({ message: error.message }), guiService: {
        ...guiService,
        async getCampaignAdSets(_accountKey, campaignId) { order.push(`list:${campaignId}`); return [{ id: "90", status: "ACTIVE" }]; },
        async getCampaignAdSetInsights(_accountKey, campaignId) { order.push(`stats:${campaignId}`); await blockedStatistics; return [{ adset_id: "90", spend: "5" }]; },
    } });
    const firstInput = { ...input, campaignId: "91" };
    const listOnly = await prioritized.refresh(firstInput);
    assert.equal(listOnly.adSets[0].id, "90");
    assert.deepEqual(order, ["list:91"]);
    // Навіть якщо статистику поставили в чергу першою, очікуваний список має пріоритет.
    const background = prioritized.refreshStatistics(firstInput);
    const foreground = prioritized.refresh({ ...input, campaignId: "92" });
    await foreground;
    assert.equal(order[1], "list:92");
    releaseStatistics();
    await background;
    assert.equal((await prioritized.read(firstInput)).adSets[0].spend, 5);

    const requests = [];
    let cbo = false, rejectedBudget = false;
    const api = new FacebookGraphApi({ accountKey: "client", accessToken: "mock", userAgent: "mock", cookie: "mock", proxyHttpClient: {
        async request(config) {
            requests.push(config);
            const endpoint = new URL(config.url).pathname.split("/").slice(2).join("/");
            if (config.method === "post") {
                if (endpoint === "10/copies") return { data: { copied_adset_id: "11" } };
                if (rejectedBudget && endpoint === "11") throw new Error("Помилка бюджету");
                return { data: { success: true } };
            }
            if (endpoint === "10") return { data: { id: "10", name: "Source", account_id: "1", campaign_id: "20", campaign: { id: "20", daily_budget: cbo ? "5000" : "0" }, daily_budget: "1000" } };
            if (endpoint === "act_1") return { data: { currency: "USD" } };
            if (endpoint === "11/ads") return { data: { data: [{ id: "12" }] } };
            return { data: { data: [] } };
        },
    } });
    const payload = { adAccountId: "act_1", campaignId: "20", adSetId: "10", count: 1, budget: 15.25 };
    const copied = await api.duplicateAdSet(payload);
    assert.equal(copied.copies[0].status, "ACTIVE");
    const writes = requests.filter((request) => request.method === "post").map((request) => ({ url: request.url, body: new URLSearchParams(request.data) }));
    assert.equal(writes[0].body.get("deep_copy"), "true");
    assert.equal(writes[0].body.get("status_option"), "PAUSED");
    assert.equal(writes[1].body.get("daily_budget"), "1525");
    assert.match(writes[2].url, /12$/); assert.equal(writes[2].body.get("status"), "ACTIVE");
    assert.match(writes[3].url, /11$/); assert.equal(writes[3].body.get("status"), "ACTIVE");
    requests.length = 0;
    const paused = await api.duplicateAdSet({ ...payload, createActive: false, startTime: "2030-01-01T10:00:00Z" });
    assert.equal(paused.copies[0].status, "PAUSED");
    assert.equal(requests.filter((request) => request.method === "post" && request.url.endsWith("/11")).length, 1);
    cbo = true; requests.length = 0;
    await api.duplicateAdSet({ ...payload, budget: null });
    assert.equal(requests.some((request) => new URLSearchParams(request.data).has("daily_budget")), false);
    cbo = false; rejectedBudget = true; requests.length = 0;
    const partial = await api.duplicateAdSet({ ...payload, count: 3 });
    assert.equal(partial.copies.length, 1); assert.ok(partial.error);
    assert.equal(requests.filter((request) => request.url.endsWith("/copies")).length, 1);
    await assert.rejects(() => api.duplicateAdSet({ ...payload, count: 0 }), /Кількість/);
    rejectedBudget = false; requests.length = 0;
    await api.deleteAdSet({ adAccountId: "act_1", campaignId: "20", adSetId: "10" });
    const deletionWrite = requests.find((request) => request.method === "post");
    assert.equal(new URLSearchParams(deletionWrite.data).get("status"), "DELETED");
    requests.length = 0;
    await assert.rejects(() => api.deleteAdSet({ adAccountId: "act_2", campaignId: "20", adSetId: "10" }), { code: "ADSET_PARENT_INVALID" });
    assert.equal(requests.some((request) => request.method === "post"), false);

    let invalidStatistics = false;
    const insightsApi = new FacebookGraphApi({ accountKey: "client", accessToken: "mock", userAgent: "mock", cookie: "mock", proxyHttpClient: {
        async request(config) {
            assert.equal(config.params.level, "adset");
            if (config.params.after) return { data: { data: invalidStatistics ? [{ spend: "2" }] : [{ adset_id: "31", spend: "2" }] } };
            return { data: { data: [{ adset_id: "30", spend: "5" }], paging: { next: "next", cursors: { after: "second" } } } };
        },
    } });
    const insightRows = await insightsApi.getCampaignAdSetInsights("20", "today");
    assert.deepEqual(insightRows.map((row) => row.adset_id), ["30", "31"]);
    invalidStatistics = true;
    await assert.rejects(() => insightsApi.getCampaignAdSetInsights("20", "today"), { code: "FACEBOOK_CAMPAIGN_LIST_INVALID" });
    assert.equal(localValueInZone(new Date("2026-11-06T10:00:00Z"), "America/Los_Angeles"), "2026-11-06T02:00");
    assert.equal(zonedValueToIso("2026-11-06T02:00", "America/Los_Angeles"), "2026-11-06T10:00:00.000Z");
    assert.equal(zonedValueToIso("2026-03-08T02:30", "America/Los_Angeles"), "");
    console.log("AdSetService: кеш, інтервали, дублювання та часові пояси — OK");
} finally { await rm(directory, { recursive: true, force: true }); }
