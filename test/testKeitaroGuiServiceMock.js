import assert from "node:assert/strict";

import KeitaroGuiService from "../services/keitaro/KeitaroGuiService.js";


const keitaro = {
    landingCalls: 0,
    campaignGroupCalls: 0,
    campaignCalls: 0,
    async getCampaign(id) {
        return {
            id,
            name: "HU [004_W] Pixel_935472558918197🎮SLOT🎮",
            parameters: {
                sub_id_6: { name: "sub_id_6", placeholder: "old-pixel", alias: "Pixel ID" },
                sub_id_12: { name: "sub_id_12", placeholder: "old-token", alias: "CAPI token" },
            },
        };
    },
    async updateCampaign(id, payload) {
        this.changedCampaign = { id, payload };
        return { id };
    },
    async listAllCampaignGroups() {
        this.campaignGroupCalls += 1;
        return [
            { id: 10, name: "Nutra" },
            { id: 20, name: "Finance" },
            { id: 30, name: "Hidden" },
        ];
    },
    async listAllCampaigns() {
        this.campaignCalls += 1;
        return [
            { id: 1, name: "CAM 1", group_id: 10, state: "active", url: "https://tracker.test/A1?utm_source=test" },
            { id: 2, name: "CAM 2", group_id: 20, state: "disabled" },
            { id: 3, name: "CAM 3", group_id: 30, state: "active" },
        ];
    },
    async buildReport(payload) {
        assert.ok(["campaign_id", "offer_id"].includes(payload.dimensions[0]));
        assert.ok(payload.metrics.includes("clicks"));
        if (payload.dimensions.includes("sub_id_2")) {
            return { rows: [{ campaign_id: 1, sub_id_2: "meta-55", clicks: "8" }] };
        }
        if (payload.dimensions[0] === "offer_id") {
            return { rows: [{ offer_id: 71, clicks: "20", sales: "3", revenue: "12" }] };
        }
        return {
            rows: [
                { campaign_id: 1, clicks: "11", conversions: "2", revenue: "30.5" },
            ],
        };
    },
    async listStreamFilters() {
        return [{ value: "country" }, { value: "os" }];
    },
    async listAllGroups({ type }) {
        return type === "landings"
            ? [{ id: 41, name: "JP" }]
            : [{ id: 36, name: "Offers JP" }];
    },
    async listAllLandings() {
        this.landingCalls += 1;
        return [
            { id: 68, name: "White", group_id: 41 },
            { id: 69, name: "Other", group_id: 42 },
        ];
    },
    async listAllOffers() {
        return [
            { id: 71, name: "ZA | [Gentlove] | Default", group_id: 36, affiliate_network_id: 8 },
            { id: 72, name: "ZA | [Gentlove] | 151mf_mob", group_id: 36, affiliate_network_id: 8 },
        ];
    },
    async listAllAffiliateNetworks() {
        return [{ id: 8, name: "Lead Network" }];
    },
    async moveCampaignsToGroup(campaignIds, groupId) {
        return campaignIds.map((id) => ({ id, ok: Number(groupId) === 20 }));
    },
    async moveOffersToGroup(offerIds, groupId) {
        return offerIds.map((id) => ({ id, ok: Number(groupId) === 36 }));
    },
};

const service = new KeitaroGuiService({
    keitaro,
    countryCatalog: {
        async list() {
            return [{ code: "JP", name: "Japan" }];
        },
    },
});
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
assert.equal(allAvailable.campaigns[0].url, "https://tracker.test/A1");
assert.equal(allAvailable.campaigns[1].clicks, 0);
assert.deepEqual(allAvailable.groups.map((item) => item.id), ["20", "10"]);

const list = await service.getCampaignsList({
    groupId: "10",
    availableGroupIds: ["10", "20"],
});
assert.deepEqual(list.campaigns.map((item) => item.id), ["1"]);
assert.equal(list.campaigns[0].clicks, undefined);
assert.deepEqual(await service.getCampaignStats({
    selectedGroupIds: list.selectedGroupIds,
    datePreset: "today",
}), [{
    id: "1",
    clicks: 11,
    uniqueClicks: 0,
    bots: 0,
    conversions: 2,
    sales: 0,
    leads: 0,
    rejected: 0,
    cr: 0,
    cost: 0,
    revenue: 30.5,
    profit: 0,
    roi: 0,
    epc: 0,
    cpc: 0,
}]);

const oneGroup = await service.getCampaignsReport({
    groupId: "20",
    availableGroupIds: ["10", "20"],
    datePreset: "yesterday",
});
assert.deepEqual(oneGroup.campaigns.map((item) => item.id), ["2"]);
assert.equal(oneGroup.campaigns[0].state, "disabled");
assert.equal(keitaro.campaignGroupCalls, 1);
assert.equal(keitaro.campaignCalls, 1);

await service.getCampaignsReport({
    groupId: "20",
    availableGroupIds: ["10", "20"],
    forceRefresh: true,
});
assert.equal(keitaro.campaignGroupCalls, 2);
assert.equal(keitaro.campaignCalls, 2);

const none = await service.getCampaignsReport({
    availableGroupIds: [],
});
assert.deepEqual(none.campaigns, []);
assert.deepEqual(await service.listCountries(), [{ code: "JP", name: "Japan" }]);
assert.deepEqual(await service.listAssetGroups("landings"), [{ id: "41", name: "JP" }]);
assert.deepEqual((await service.listLandingPages({ groupId: "41" })).map((item) => item.id), ["68"]);
assert.deepEqual((await service.listLandingPages({ groupId: "all" })).map((item) => item.id), ["68", "69"]);
assert.equal(keitaro.landingCalls, 1);
const offerReport = await service.getOffersReport({ groupId: "36" });
assert.equal(offerReport.offers.length, 2);
assert.equal(offerReport.offers[0].affiliateNetworkName, "Lead Network");
assert.equal(offerReport.offers[0].clicks, 20);
assert.equal(offerReport.offers[1].clicks, 0);
assert.equal((await service.moveCampaignsToGroup({ campaignIds: [1], groupId: 20 }))[0].ok, true);
assert.equal((await service.moveOffersToGroup({ offerIds: [71], groupId: 36 }))[0].ok, true);
const pixelChange = await service.changeCampaignPixels({ campaignIds: [1], pixelId: "123456789", pixelToken: "new-token" });
assert.deepEqual(pixelChange, [{ campaignId: "1", ok: true }]);
assert.equal(keitaro.changedCampaign.payload.name, "HU [004_W] Pixel_123456789🎮SLOT🎮");
assert.equal(keitaro.changedCampaign.payload.parameters.sub_id_6.placeholder, "123456789");
assert.equal(keitaro.changedCampaign.payload.parameters.sub_id_12.placeholder, "new-token");
assert.deepEqual(await service.getSpendMappings({
    from: "2026-09-01",
    to: "2026-09-03",
    groupIds: [10],
}), [{ keitaroCampaignId: "1", metaCampaignId: "meta-55", clicks: 8 }]);
let spendUpdate = null;
keitaro.updateCampaignCosts = async (id, payload) => {
    spendUpdate = { id, payload };
    return { success: true };
};
await service.updateSpendCosts("1", { cost: "12.5" });
assert.deepEqual(spendUpdate, { id: "1", payload: { cost: "12.5" } });

let matchingPayload = null;
keitaro.applyStreamTemplateToMatchingStreams = async (payload) => {
    matchingPayload = payload;
    return { matched: 1, updated: 1, failed: 0 };
};
await service.applyStreamTemplateToMatchingStreams({
    stream: { name: "AT OFFERS", landings: [], offers: [] },
    streamName: "AT OFFERS",
});
assert.equal(matchingPayload.streamName, "AT OFFERS");

let campaignPayload = null;
const createdStreams = [];
keitaro.getStream = async (id) => {
    assert.equal(id, 3119);
    return {
        id: 3119,
        campaign_id: 99,
        name: "Source",
        state: "active",
        schema: "landings",
        collect_clicks: true,
        uniqueness_method: "ip_ua",
        uniqueness_use_cookies: true,
        filters: [{ id: 1, name: "country", mode: "accept", payload: ["DE"] }],
        landings: [{ id: 5, landing_id: 68, share: 100, state: "active" }],
        offers: [],
    };
};
keitaro.getTrafficSource = async () => ({
    parameters: {
        sub_id_6: { name: "sub_id_6", placeholder: "", alias: "Pixel ID" },
        sub_id_12: { name: "sub_id_12", placeholder: "", alias: "CAPI token" },
    },
});
keitaro.createCampaign = async (payload) => {
    campaignPayload = payload;
    return { id: 42 };
};
keitaro.createStream = async (payload) => {
    createdStreams.push(payload);
    return { id: createdStreams.length };
};
await service.createCampaignWithWhiteStream({
    name: "AT [001_W] Pixel_935",
    groupId: "7",
    domainId: "8",
    trafficSourceId: "9",
    pixelId: "935",
    pixelToken: "public-token",
    geo: "AT",
    excludedCountries: ["DE"],
    landings: [{ landing_id: "123", share: 65, state: "disabled" }],
    identifier: "AJ001T",
    streamTemplate: { stream: { name: "Second", landings: [], offers: [], filters: [] } },
});
assert.equal(campaignPayload.parameters.sub_id_6.placeholder, "935");
assert.equal(campaignPayload.parameters.sub_id_12.placeholder, "public-token");
assert.equal(campaignPayload.parameters.sub_id_6.alias, "Pixel ID");
assert.equal(campaignPayload.parameters.sub_id_12.alias, "CAPI token");
assert.equal(campaignPayload.alias, "AJ001T");
assert.equal(campaignPayload.cost_auto, true);
assert.equal(createdStreams.length, 2);
assert.equal(createdStreams[0].position, 1);
assert.equal(createdStreams[0].name, "White");
assert.equal(createdStreams[0].comments, "AJ001T");
assert.equal(createdStreams[0].schema, "landings");
assert.equal(createdStreams[0].collect_clicks, true);
assert.equal(createdStreams[0].uniqueness_method, "ip_ua");
assert.equal(createdStreams[0].uniqueness_use_cookies, true);
assert.deepEqual(createdStreams[0].landings, [{ landing_id: 123, share: 65, state: "disabled" }]);
assert.deepEqual(createdStreams[0].filters.at(-1), {
    name: "country", mode: "reject", payload: ["AT", "DE"],
});
assert.equal(createdStreams[1].position, 2);

console.log("Перевірка Keitaro GUI-сервісу пройшла успішно");
