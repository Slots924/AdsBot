import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdSetService from "../services/gui/AdSetService.js";
import RemoteDataCacheStore from "../services/gui/RemoteDataCacheStore.js";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import { localValueInZone, zonedValueToIso } from "../frontend/src/lib/accountTime.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-adsets-"));
try {
    const cacheFile = path.join(directory, "cache.json");
    let clock = new Date("2026-11-06T10:00:00Z");
    let listCalls = 0, statCalls = 0, fail = false, failStats = false, empty = false;
    const guiService = {
        async getCampaignAdSets() { listCalls++; if (fail) throw new Error("Токен недійсний"); return empty ? [] : [{ id: "10", name: "Адсет", effectiveStatus: "ACTIVE" }]; },
        async getCampaignAdSetInsights() { statCalls++; if (failStats) throw new Error("Статистика недоступна"); return [{ adset_id: "10", spend: "12", impressions: "1000", clicks: "20", actions: [{ action_type: "lead", value: "3" }] }]; },
        async duplicateAdSet() { return { copies: [{ id: "11", name: "Копія", status: "ACTIVE" }] }; },
    };
    const cache = new RemoteDataCacheStore({ cacheFile, now: () => clock });
    await cache.setWorkspacePart("client", { adAccounts: [{ id: "act_1", timezoneName: "America/Los_Angeles" }] });
    const create = (store = cache) => new AdSetService({ cache: store, guiService, now: () => clock, serializeError: (error) => ({ message: error.message }) });
    const service = create();
    const input = { accountKey: "client", adAccountId: "act_1", campaignId: "20", datePreset: "today" };
    assert.equal((await service.read(input)).cacheHit, false);
    const results = await Promise.all([service.refresh(input), service.refresh(input), service.refresh(input)]);
    assert.equal(listCalls, 1); assert.equal(statCalls, 1);
    assert.equal(results[0].adSets[0].costPerLead, 4);
    assert.equal(results[0].context.timeZone, "America/Los_Angeles");
    clock = new Date(clock.getTime() + 60_000);
    await service.refresh(input);
    assert.equal(listCalls, 2); assert.equal(statCalls, 1);
    clock = new Date(clock.getTime() + 14 * 60_000);
    await service.refresh(input);
    assert.equal(listCalls, 3); assert.equal(statCalls, 2);
    fail = true; clock = new Date(clock.getTime() + 60_000);
    const failed = await service.refresh(input);
    assert.equal(failed.adSets[0].spend, 12);
    assert.match(failed.refreshError.message, /Токен/);
    const restarted = create(new RemoteDataCacheStore({ cacheFile, now: () => clock }));
    assert.equal((await restarted.read(input)).adSets[0].leads, 3);
    await restarted.refresh(input); assert.equal(listCalls, 4);
    const other = await restarted.read({ ...input, accountKey: "another-client", datePreset: "yesterday" });
    assert.equal(other.adSets[0].spend, 12); assert.equal(other.statisticsStale, true);
    fail = false; failStats = true; clock = new Date(clock.getTime() + 15 * 60_000);
    const statsFailed = await restarted.refresh(input);
    assert.equal(statsFailed.adSets[0].leads, 3); assert.match(statsFailed.refreshError.message, /Статистика/);
    await restarted.refresh(input); assert.equal(statCalls, 3);
    empty = true; clock = new Date(clock.getTime() + 60_000);
    assert.equal((await restarted.refresh(input)).adSets[0].missingFromLatestRead, true);
    await restarted.duplicate(input);
    assert.equal((await restarted.read(input)).adSets.length, 2);

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
            if (endpoint === "10") return { data: { id: "10", name: "Source", account_id: "1", campaign: { id: "20", daily_budget: cbo ? "5000" : "0" }, daily_budget: "1000" } };
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
    assert.equal(localValueInZone(new Date("2026-11-06T10:00:00Z"), "America/Los_Angeles"), "2026-11-06T02:00");
    assert.equal(zonedValueToIso("2026-11-06T02:00", "America/Los_Angeles"), "2026-11-06T10:00:00.000Z");
    assert.equal(zonedValueToIso("2026-03-08T02:30", "America/Los_Angeles"), "");
    console.log("AdSetService: кеш, інтервали, дублювання та часові пояси — OK");
} finally { await rm(directory, { recursive: true, force: true }); }
