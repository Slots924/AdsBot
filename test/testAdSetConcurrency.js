import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AdSetService from "../services/gui/AdSetService.js";
import RemoteDataCacheStore from "../services/gui/RemoteDataCacheStore.js";

const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};
const within = async (promise) => {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Запит перемикача чекає на заблоковану операцію")), 2000); })]);
    } finally { clearTimeout(timer); }
};
const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-adset-concurrency-"));
try {
    const cacheFile = path.join(directory, "cache.json");
    const now = () => new Date("2026-11-06T12:00:00Z");
    const cache = new RemoteDataCacheStore({ cacheFile, now });
    const input = { accountKey: "client", adAccountId: "act_1", campaignId: "100", datePreset: "today" };
    const rows = ["1", "2", "3"].map((id) => ({ id, name: `Ad set ${id}`, status: "ACTIVE", effectiveStatus: "ACTIVE" }));
    const seed = (target) => cache.setAdSetSnapshot(target.adAccountId, target.campaignId, { adSets: rows, listUpdatedAt: "2026-11-06T11:00:00Z" });
    const create = (guiService) => { guiService.getRejectedAdSetIds ??= async () => []; return new AdSetService({ cache, guiService, now, serializeError: (error) => ({ message: error.message }) }); };

    await seed(input);
    const statisticsStarted = deferred(), statisticsResponse = deferred();
    const firstStarted = deferred(), secondStarted = deferred();
    const firstResponse = deferred(), secondResponse = deferred();
    const statusCalls = [];
    const service = create({
        async getCampaignAdSetInsights() { statisticsStarted.resolve(); await statisticsResponse.promise; return [{ adset_id: "1", spend: "12" }]; },
        async setAdSetStatus(_key, update) {
            statusCalls.push(update.adSetId);
            (update.adSetId === "1" ? firstStarted : secondStarted).resolve();
            await (update.adSetId === "1" ? firstResponse : secondResponse).promise;
            return { id: update.adSetId, status: update.status, effectiveStatus: update.status };
        },
    });
    const statistics = service.refreshStatistics(input);
    await statisticsStarted.promise;
    const first = service.setStatus({ ...input, adSetId: "1", status: "PAUSED" });
    const second = service.setStatus({ ...input, adSetId: "2", status: "PAUSED" });
    await within(Promise.all([firstStarted.promise, secondStarted.promise]));
    await assert.rejects(() => service.setStatus({ ...input, adSetId: "1", status: "ACTIVE" }), { code: "ADSET_STATUS_PENDING" });
    assert.deepEqual(statusCalls, ["1", "2"]);
    // Відповіді перемикачів надходять у зворотному порядку, статистика ще не завершилась.
    secondResponse.resolve(); await within(second);
    firstResponse.resolve(); await within(first);
    statisticsResponse.resolve(); await statistics;
    const current = await service.read(input);
    assert.deepEqual(current.adSets.map((row) => row.status), ["PAUSED", "PAUSED", "ACTIVE"]);
    assert.equal(current.adSets[0].spend, 12);
    const restarted = new RemoteDataCacheStore({ cacheFile, now });
    assert.deepEqual((await restarted.getAdSetSnapshot("act_1", "100")).adSets.map((row) => row.status), ["PAUSED", "PAUSED", "ACTIVE"]);

    const listInput = { ...input, campaignId: "200" };
    await seed(listInput);
    const listStarted = deferred(), listResponse = deferred();
    const listService = create({
        async getCampaignAdSets() { listStarted.resolve(); await listResponse.promise; return rows.map((row) => ({ ...row, name: `Updated ${row.id}` })); },
        async setAdSetStatus(_key, update) { return { id: update.adSetId, status: update.status, effectiveStatus: update.status }; },
    });
    const list = listService.refresh(listInput);
    await listStarted.promise;
    await within(Promise.all(["1", "2"].map((adSetId) => listService.setStatus({ ...listInput, adSetId, status: "PAUSED" }))));
    listResponse.resolve(); await list;
    const afterList = (await listService.read(listInput)).adSets;
    assert.deepEqual(afterList.map((row) => row.status), ["PAUSED", "PAUSED", "ACTIVE"]);
    assert.equal(afterList[0].name, "Updated 1");

    const duplicateInput = { ...input, campaignId: "300" };
    await seed(duplicateInput);
    const copyCreated = deferred(), duplicateResponse = deferred();
    const copies = [{ id: "4", name: "Copy 1", status: "ACTIVE", effectiveStatus: "ACTIVE" }];
    const duplicateGui = {
        async duplicateAdSet(_key, _input, context) {
            await context.onProgress({ completed: 1, total: 2, copies: [...copies] });
            copyCreated.resolve();
            await duplicateResponse.promise;
            copies.push({ id: "5", name: "Copy 2", status: "ACTIVE", effectiveStatus: "ACTIVE" });
            await context.onProgress({ completed: 2, total: 2, copies: [...copies] });
            return { copies };
        },
        async setAdSetStatus(_key, update) { return { id: update.adSetId, status: update.status, effectiveStatus: update.status }; },
    };
    const duplicateService = create(duplicateGui);
    const duplicate = duplicateService.duplicate({ ...duplicateInput, adSetId: "1", count: 2 });
    await copyCreated.promise;
    await within(Promise.all(["1", "4"].map((adSetId) => duplicateService.setStatus({ ...duplicateInput, adSetId, status: "PAUSED" }))));
    duplicateResponse.resolve(); await duplicate;
    const afterDuplicate = (await duplicateService.read(duplicateInput)).adSets;
    assert.deepEqual(afterDuplicate.map((row) => row.id), ["1", "2", "3", "4", "5"]);
    assert.equal(afterDuplicate.find((row) => row.id === "1").status, "PAUSED");
    assert.equal(afterDuplicate.find((row) => row.id === "4").status, "PAUSED");
    const setStatus = duplicateGui.setAdSetStatus;
    duplicateGui.setAdSetStatus = async () => { throw new Error("Токен недійсний"); };
    await assert.rejects(() => duplicateService.setStatus({ ...duplicateInput, adSetId: "1", status: "ACTIVE" }), /Токен/);
    assert.equal((await duplicateService.read(duplicateInput)).adSets[0].status, "PAUSED");
    duplicateGui.setAdSetStatus = setStatus;
    await duplicateService.setStatus({ ...duplicateInput, adSetId: "1", status: "ACTIVE" });
    assert.equal((await duplicateService.read(duplicateInput)).adSets[0].status, "ACTIVE");
    console.log("Адсети: паралельні перемикачі, блокування одного ID та узгоджений кеш — OK");
} finally { await rm(directory, { recursive: true, force: true }); }
