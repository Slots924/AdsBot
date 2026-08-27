import assert from "node:assert/strict";

import KeitaroGuiService from "../services/keitaro/KeitaroGuiService.js";


const keitaro = {
    async listAllCampaignGroups() {
        return [
            { id: 10, name: "Nutra" },
            { id: 20, name: "Finance" },
            { id: 30, name: "Hidden" },
        ];
    },
    async listAllCampaigns() {
        return [
            { id: 1, name: "CAM 1", group_id: 10, state: "active" },
            { id: 2, name: "CAM 2", group_id: 20, state: "disabled" },
            { id: 3, name: "CAM 3", group_id: 30, state: "active" },
        ];
    },
    async buildReport(payload) {
        assert.equal(payload.dimensions[0], "campaign_id");
        assert.ok(payload.metrics.includes("clicks"));
        return {
            rows: [
                { campaign_id: 1, clicks: "11", conversions: "2", revenue: "30.5" },
            ],
        };
    },
};

const service = new KeitaroGuiService({ keitaro });
const groups = await service.listCampaignGroups();
assert.deepEqual(groups.map((item) => item.id), ["20", "30", "10"]);

const allAvailable = await service.getCampaignsReport({
    groupId: "all",
    availableGroupIds: ["10", "20"],
    datePreset: "today",
});
assert.equal(allAvailable.campaigns.length, 2);
assert.equal(allAvailable.campaigns[0].clicks, 11);
assert.equal(allAvailable.campaigns[0].conversions, 2);
assert.equal(allAvailable.campaigns[0].revenue, 30.5);
assert.equal(allAvailable.campaigns[1].clicks, 0);
assert.deepEqual(allAvailable.groups.map((item) => item.id), ["20", "10"]);

const oneGroup = await service.getCampaignsReport({
    groupId: "20",
    availableGroupIds: ["10", "20"],
    datePreset: "yesterday",
});
assert.deepEqual(oneGroup.campaigns.map((item) => item.id), ["2"]);
assert.equal(oneGroup.campaigns[0].state, "disabled");

const none = await service.getCampaignsReport({
    availableGroupIds: [],
});
assert.deepEqual(none.campaigns, []);

console.log("Перевірка Keitaro GUI-сервісу пройшла успішно");
