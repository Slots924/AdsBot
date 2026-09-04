import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import SpendService from "../services/spend/SpendService.js";
import SpendStore from "../services/spend/SpendStore.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-spend-"));
const store = await new SpendStore({
    databaseFile: path.join(directory, "spend.sqlite"),
}).initialize();

try {
    assert.equal(store.getSettings().startDate, "2026-09-01");
    assert.equal(store.getSettings().commissionPercent, 10);
    store.saveSettings({ commissionPercent: 10, reconciliationDays: 7, keitaroGroupIds: ["10", "10"] });
    assert.equal(store.getSettings().commissionPercent, 10);
    assert.equal(store.getSettings().reconciliationDays, 7);
    assert.deepEqual(store.getSettings().keitaroGroupIds, ["10"]);

    let spendCalls = 0;
    const exported = [];
    const service = new SpendService({
        store,
        clock: () => new Date("2026-09-03T12:03:00.000Z"),
        facebookAccountManager: {
            async list() {
                return [
                    { accountKey: "account-001", archived: false },
                    { accountKey: "account-002", archived: false },
                ];
            },
        },
        guiService: {
            async getAdAccounts() {
                return [{
                    id: "act_1",
                    name: "Main",
                    currency: "USD",
                    timezoneName: "Europe/Kyiv",
                }];
            },
            async getAdCampaignSpend(accountKey, adAccountId, range) {
                spendCalls += 1;
                assert.equal(accountKey, "account-001");
                assert.equal(adAccountId, "act_1");
                assert.equal(range.since, "2026-09-01");
                return [{
                    campaignId: "meta-55",
                    campaignName: "Campaign",
                    spend: "12.345678",
                    dateStart: "2026-09-03",
                }];
            },
        },
        keitaroGuiService: {
            async getSpendMappings() {
                return [{ metaCampaignId: "meta-55", keitaroCampaignId: "77" }];
            },
            async updateSpendCosts(id, payload) {
                exported.push({ id, payload });
                return { success: true };
            },
        },
        logger: { warn() {} },
    });

    const collected = await service.collect();
    assert.equal(collected.status, "success");
    assert.equal(collected.uniqueAdAccounts, 1);
    assert.equal(spendCalls, 1);
    assert.equal(service.getOverview().campaigns[0].spend, 12.345678);

    const sent = await service.exportToKeitaro();
    assert.equal(sent.sent, 1);
    assert.equal(exported[0].id, "77");
    assert.equal(exported[0].payload.cost, "13.580246");
    assert.deepEqual(exported[0].payload.filters, { sub_id_2: "meta-55" });
    assert.equal(service.getOverview().campaigns[0].status, "synced");
    assert.equal(service.getOverview().campaigns[0].spendWithCommission, 13.580246);
    assert.equal(service.getOverview().campaigns[0].exported, 13.580246);

    const repeated = await service.exportToKeitaro();
    assert.equal(repeated.sent, 0);
    assert.equal(exported.length, 1);

    store.saveSettings({ commissionPercent: 12.5 });
    assert.equal(service.getOverview().campaigns[0].status, "pending");
    const commissionChanged = await service.exportToKeitaro();
    assert.equal(commissionChanged.sent, 1);
    assert.equal(exported[1].payload.cost, "13.888888");
} finally {
    store.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

console.log("Перевірка сервісу спенду пройшла успішно");
