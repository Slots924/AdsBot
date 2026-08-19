import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import AdsBotGuiService from "../services/gui/AdsBotGuiService.js";


const requests = [];
const graphApi = new FacebookGraphApi({
    accountKey: "active",
    accessToken: "secret",
    cookie: "cookie",
    userAgent: "agent",
    proxyHttpClient: {
        async request(config) {
            requests.push(config);
            const isCampaigns = config.url.endsWith("/act_1/campaigns");
            const secondPage = config.params.after === "page-2";

            if (isCampaigns) {
                return { data: secondPage ? {
                    data: [{
                        id: "c2",
                        name: "Campaign 2",
                        status: "PAUSED",
                        effective_status: "PAUSED",
                    }],
                } : {
                    data: [{
                        id: "c1",
                        name: "Campaign 1",
                        status: "ACTIVE",
                        effective_status: "ACTIVE",
                    }],
                    paging: {
                        next: "https://graph.facebook.com/next",
                        cursors: { after: "page-2" },
                    },
                } };
            }

            return { data: {
                data: [{
                    campaign_id: "c1",
                    campaign_name: "Campaign 1",
                    spend: "12.50",
                    actions: [{ action_type: "lead", value: "5" }],
                }],
            } };
        },
    },
});

const graphCampaigns = await graphApi.getAdCampaigns("act_1");
const graphInsights = await graphApi.getAdCampaignInsights("act_1", "last_7d");
assert.equal(graphCampaigns.length, 2);
assert.equal(graphInsights[0].spend, "12.50");
assert.equal(requests[1].params.after, "page-2");
assert.equal(requests[2].params.date_preset, "last_7d");
assert.equal(requests[2].params.level, "campaign");
assert.match(requests[0].params.filtering, /ACTIVE/);
await assert.rejects(
    graphApi.getAdCampaignInsights("act_1", "invalid"),
    { code: "FACEBOOK_INSIGHTS_DATE_PRESET_INVALID" }
);

const facebookBackend = {
    async getAccounts() {
        return [{ accountKey: "active", status: "active" }];
    },
    async getAdCampaigns(accountKey, adAccountId, datePreset) {
        assert.equal(accountKey, "active");
        assert.equal(adAccountId, "act_1");
        assert.equal(datePreset, "today");
        return {
            campaigns: [
                { id: "3", name: "A active", status: "ACTIVE", effectiveStatus: "ACTIVE" },
                { id: "2", name: "B active", status: "ACTIVE", effectiveStatus: "ACTIVE" },
                { id: "1", name: "Z paused", status: "PAUSED", effectiveStatus: "PAUSED" },
                { id: "4", name: "Archived", status: "ARCHIVED", effectiveStatus: "ARCHIVED" },
            ],
            insights: [
                {
                    campaignId: "1",
                    spend: "10",
                    actions: [
                        { action_type: "lead", value: "2" },
                        { action_type: "offsite_conversion.fb_pixel_lead", value: "20" },
                    ],
                },
                { campaignId: "2", spend: "7.5", actions: [] },
            ],
        };
    },
};
const guiService = new AdsBotGuiService({
    facebookBackend,
    logger: { info() {}, warn() {}, error() {} },
});
await guiService.getAccounts();
const normalized = await guiService.getAdCampaigns(
    "active",
    "act_1",
    "today"
);
assert.deepEqual(normalized.campaigns.map((campaign) => campaign.id), [
    "3",
    "2",
    "1",
]);
assert.equal(normalized.campaigns[2].leads, 2);
assert.equal(normalized.campaigns[2].spend, 10);
assert.equal(normalized.campaigns[2].costPerLead, 5);
assert.equal(normalized.campaigns[1].costPerLead, null);

console.log("Mock-перевірка кампаній Facebook пройшла успішно");
