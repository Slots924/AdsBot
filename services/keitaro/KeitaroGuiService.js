import Keitaro, { normalizeList } from "../../classes/Keitaro.js";
import { keitaroReportMetrics } from "./reportColumns.js";


function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}


function isoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}


function rangeFromPreset(preset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    const end = new Date(today);

    if (preset === "yesterday") {
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
    } else if (preset === "last_7d") {
        start.setDate(start.getDate() - 6);
    } else if (preset === "last_30d") {
        start.setDate(start.getDate() - 29);
    } else if (preset === "maximum") {
        start.setFullYear(2010, 0, 1);
    }

    return {
        from: isoDate(start),
        to: isoDate(end),
        timezone: "Europe/Kyiv",
    };
}


function campaignState(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "active" || normalized === "1") return "active";
    if (normalized === "disabled" || normalized === "0") return "disabled";
    return normalized || "unknown";
}


function formatGroup(group) {
    return {
        id: String(group?.id ?? "").trim(),
        name: String(group?.name ?? "").trim() || "Без назви",
    };
}


export default class KeitaroGuiService {
    constructor({ keitaro, keitaroFactory } = {}) {
        this.keitaro = keitaro ?? (keitaroFactory ? keitaroFactory() : new Keitaro());
    }


    async listCampaignGroups() {
        const groups = await this.keitaro.listAllCampaignGroups();
        return groups
            .map(formatGroup)
            .filter((group) => group.id)
            .sort((left, right) => left.name.localeCompare(right.name, "uk-UA", {
                numeric: true,
                sensitivity: "base",
            }));
    }


    async getCampaignsReport({
        groupId = "all",
        availableGroupIds = [],
        datePreset = "today",
    } = {}) {
        const available = [...new Set(
            (Array.isArray(availableGroupIds) ? availableGroupIds : [])
                .map((id) => String(id ?? "").trim())
                .filter(Boolean)
        )];
        const groups = (await this.listCampaignGroups())
            .filter((group) => available.includes(group.id));
        const selectedGroupIds = groupId && groupId !== "all"
            ? groups.filter((group) => group.id === String(groupId)).map((group) => group.id)
            : groups.map((group) => group.id);

        if (selectedGroupIds.length === 0) {
            return {
                campaigns: [],
                groups,
                datePreset,
                range: rangeFromPreset(datePreset),
            };
        }

        const groupNameById = new Map(
            groups.map((group) => [group.id, group.name])
        );
        const selectedSet = new Set(selectedGroupIds);
        const campaigns = (await this.keitaro.listAllCampaigns())
            .filter((campaign) => selectedSet.has(String(
                campaign?.group_id ?? campaign?.groupId ?? ""
            )));

        const report = await this.keitaro.buildReport({
            range: rangeFromPreset(datePreset),
            dimensions: ["campaign_id"],
            metrics: keitaroReportMetrics,
            filters: selectedGroupIds.length === 1
                ? [{
                    name: "campaign_group_id",
                    operator: "EQUALS",
                    expression: Number(selectedGroupIds[0]),
                }]
                : [{
                    name: "campaign_group_id",
                    operator: "IN_LIST",
                    expression: selectedGroupIds.map(Number),
                }],
        });

        const statsById = new Map();
        for (const row of normalizeList(report)) {
            const id = String(row?.campaign_id ?? row?.campaignId ?? "").trim();
            if (!id) continue;
            statsById.set(id, row);
        }

        return {
            campaigns: campaigns.map((campaign) => {
                const id = String(campaign?.id ?? "").trim();
                const stats = statsById.get(id) ?? {};
                const groupKey = String(campaign?.group_id ?? campaign?.groupId ?? "");
                return {
                    id,
                    name: String(campaign?.name ?? "").trim() || "Без назви",
                    groupId: groupKey,
                    groupName: groupNameById.get(groupKey) || "",
                    state: campaignState(campaign?.state),
                    clicks: numberOrZero(stats.clicks),
                    uniqueClicks: numberOrZero(
                        stats.campaign_unique_clicks ?? stats.unique_clicks
                    ),
                    bots: numberOrZero(stats.bots),
                    conversions: numberOrZero(stats.conversions),
                    sales: numberOrZero(stats.sales),
                    leads: numberOrZero(stats.leads),
                    rejected: numberOrZero(stats.rejected),
                    cr: numberOrZero(stats.crs ?? stats.cr),
                    cost: numberOrZero(stats.cost),
                    revenue: numberOrZero(stats.revenue),
                    profit: numberOrZero(stats.profit),
                    roi: numberOrZero(stats.roi),
                    epc: numberOrZero(stats.epc),
                    cpc: numberOrZero(stats.cpc),
                };
            }),
            groups,
            datePreset,
            range: rangeFromPreset(datePreset),
        };
    }
}
