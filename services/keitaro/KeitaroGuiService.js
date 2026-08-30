import Keitaro, { normalizeList } from "../../classes/Keitaro.js";
import { keitaroReportMetrics } from "./reportColumns.js";


function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}


function emptyCampaignStats() {
    return {
        clicks: 0,
        uniqueClicks: 0,
        bots: 0,
        conversions: 0,
        sales: 0,
        leads: 0,
        rejected: 0,
        cr: 0,
        cost: 0,
        revenue: 0,
        profit: 0,
        roi: 0,
        epc: 0,
        cpc: 0,
    };
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


function copyStreamForCampaign(stream = {}) {
    const copy = structuredClone(stream);
    for (const key of [
        "id", "campaign_id", "campaignId", "position", "created_at",
        "updated_at", "is_monitoring", "monitoring_url",
    ]) delete copy[key];
    copy.landings = normalizeList(copy.landings).map((item) => ({
        landing_id: Number(item?.landing_id ?? item?.id),
        share: Number(item?.share) || 100,
        state: item?.state === "disabled" ? "disabled" : "active",
    })).filter((item) => Number.isInteger(item.landing_id) && item.landing_id > 0);
    copy.offers = normalizeList(copy.offers).map((item) => ({
        offer_id: Number(item?.offer_id ?? item?.id),
        share: Number(item?.share) || 100,
        state: item?.state === "disabled" ? "disabled" : "active",
    })).filter((item) => Number.isInteger(item.offer_id) && item.offer_id > 0);
    copy.filters = normalizeList(copy.filters).map((item) => {
        const filter = structuredClone(item);
        for (const key of ["id", "stream_id", "oid", "created_at", "updated_at"]) delete filter[key];
        return filter;
    });
    return copy;
}


function withCapiPixelParameters(source, pixelId, token) {
    const parameters = structuredClone(source ?? {});
    if (Array.isArray(parameters)) {
        const set = (name, value) => {
            const item = parameters.find((entry) => String(entry?.name ?? entry?.key) === name);
            if (item) item.value = value;
            else parameters.push({ name, value });
        };
        set("sub_id_6", pixelId);
        set("sub_id_12", token);
        return parameters;
    }
    const setPlaceholder = (name, placeholder) => {
        const current = parameters[name];
        if (current && typeof current === "object" && !Array.isArray(current)) {
            current.placeholder = placeholder;
            return;
        }
        parameters[name] = { name, placeholder, alias: "" };
    };
    setPlaceholder("sub_id_6", pixelId);
    setPlaceholder("sub_id_12", token);
    return parameters;
}


function campaignAlias(identifier) {
    const value = String(identifier ?? "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/[-_]{2,}/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "");
    return value.slice(0, 100);
}


export default class KeitaroGuiService {
    constructor({ keitaro, keitaroFactory, countryCatalog } = {}) {
        this.keitaro = keitaro ?? (keitaroFactory ? keitaroFactory() : new Keitaro());
        this.countryCatalog = countryCatalog ?? null;
        this.landingPagesCache = null;
        this.offersCache = null;
        this.campaignGroupsCache = null;
        this.campaignsCache = null;
        this.campaignGroupsRequest = null;
        this.campaignsRequest = null;
    }


    setConcurrency(value) {
        return this.keitaro.setConcurrency(value);
    }


    async listLandingPages({ groupId = "all" } = {}) {
        const pages = this.landingPagesCache ?? await this.keitaro.listAllLandings();
        this.landingPagesCache = pages;
        return pages.map((item) => ({
            id: String(item?.id ?? "").trim(),
            name: String(item?.name ?? "").trim() || "Без назви",
            groupId: String(item?.group_id ?? item?.groupId ?? "").trim(),
            state: item?.state === "disabled" ? "disabled" : "active",
        })).filter((item) => item.id && (
            groupId === "all" || item.groupId === String(groupId)
        ));
    }


    async listOffers({ groupId = "all" } = {}) {
        const offers = this.offersCache ?? await this.keitaro.listAllOffers();
        this.offersCache = offers;
        return offers.map((item) => ({
            id: String(item?.id ?? "").trim(),
            name: String(item?.name ?? "").trim() || "Без назви",
            groupId: String(item?.group_id ?? item?.groupId ?? "").trim(),
            state: item?.state === "disabled" ? "disabled" : "active",
        })).filter((item) => item.id && (
            groupId === "all" || item.groupId === String(groupId)
        ));
    }


    async listAssetGroups(kind) {
        const type = kind === "offers" ? "offers" : "landings";
        const groups = await this.keitaro.listAllGroups({ type });
        return groups.map(formatGroup).filter((group) => group.id);
    }

    async listDomains() {
        return (await this.keitaro.listAllDomains())
            .map((item) => ({
                id: String(item?.id ?? "").trim(),
                name: String(item?.name ?? item?.domain ?? "").trim()
                    || "Без назви",
            }))
            .filter((item) => item.id)
            .sort((left, right) => left.name.localeCompare(right.name, "uk-UA", {
                numeric: true,
                sensitivity: "base",
            }));
    }

    async listTrafficSources() {
        return (await this.keitaro.listAllTrafficSources())
            .map((item) => ({ id: String(item?.id ?? "").trim(), name: String(item?.name ?? "").trim() || "Без назви" }))
            .filter((item) => item.id)
            .sort((left, right) => left.name.localeCompare(right.name, "uk-UA", { numeric: true, sensitivity: "base" }));
    }

    async createCampaignWithWhiteStream({
        name,
        groupId,
        domainId,
        trafficSourceId,
        pixelId,
        pixelToken,
        geo,
        excludedCountries = [],
        landingIds = [],
        landings = [],
        identifier = "",
        streamTemplate = null,
    } = {}) {
        if (!name || !groupId || !domainId || !trafficSourceId || !pixelId || !pixelToken || !geo) {
            throw new Error("Заповніть назву, групу, домен, GEO, піксель і джерело трафіку");
        }
        const [source, trafficSource] = await Promise.all([
            this.keitaro.getStream(3119),
            this.keitaro.getTrafficSource(trafficSourceId),
        ]);
        const campaign = await this.keitaro.createCampaign({
            name: String(name).trim(),
            alias: campaignAlias(identifier),
            group_id: Number(groupId),
            domain_id: Number(domainId),
            traffic_source_id: Number(trafficSourceId),
            state: "active",
            cost_auto: true,
            parameters: withCapiPixelParameters(trafficSource?.parameters, pixelId, pixelToken),
        });
        const campaignId = Number(campaign?.id ?? campaign?.campaign?.id);
        if (!Number.isInteger(campaignId) || campaignId < 1) {
            throw new Error("Keitaro не повернув ID створеної кампанії");
        }
        const countries = [...new Set([geo, ...excludedCountries].map((item) => String(item).trim().toUpperCase()).filter(Boolean))];
        const white = copyStreamForCampaign(source);
        white.name = "White";
        white.comments = String(identifier).trim();
        white.position = 1;
        const configuredLandings = Array.isArray(landings) && landings.length
            ? landings
            : Array.isArray(landingIds) && landingIds.length
                ? landingIds.map((id) => ({ landing_id: id, share: 100, state: "active" }))
                : [{ landing_id: 123, share: 100, state: "active" }];
        white.landings = configuredLandings.map((item) => ({
            landing_id: Number(item?.landing_id ?? item?.id),
            share: Number.isFinite(Number(item?.share)) ? Number(item.share) : 100,
            state: item?.state === "disabled" ? "disabled" : "active",
        })).filter((item) => Number.isInteger(item.landing_id) && item.landing_id > 0);
        white.filters = white.filters.filter((item) => item.name !== "country");
        white.filters.push({ name: "country", mode: "reject", payload: countries });
        const whiteStream = await this.keitaro.createStream({ ...white, campaign_id: campaignId });
        let templateStream = null;
        if (streamTemplate?.stream) {
            const template = copyStreamForCampaign(streamTemplate.stream);
            template.position = 2;
            templateStream = await this.keitaro.createStream({ ...template, campaign_id: campaignId });
        }
        this.campaignsCache = null;
        return { campaign, whiteStream, templateStream };
    }


    async listCountries() {
        const filters = normalizeList(await this.keitaro.listStreamFilters());
        if (!filters.some((item) => String(item?.value ?? item?.name) === "country")) {
            return [];
        }
        const source = this.countryCatalog ? await this.countryCatalog.list() : [];
        return source.map((item) => ({
            code: String(item?.code ?? item?.id ?? item?.value ?? "").trim().toUpperCase(),
            name: String(item?.name ?? item?.label ?? item?.title ?? "").trim(),
        })).filter((item) => item.code).sort((left, right) => (
            left.name.localeCompare(right.name, "uk-UA", { sensitivity: "base" })
        ));
    }


    applyStreamTemplate(options) {
        return this.keitaro.applyStreamTemplateToCampaigns(options);
    }


    async listCampaignGroups({ forceRefresh = false } = {}) {
        if (forceRefresh) this.campaignGroupsCache = null;
        if (this.campaignGroupsCache) return this.campaignGroupsCache;
        if (!this.campaignGroupsRequest) {
            this.campaignGroupsRequest = this.keitaro.listAllCampaignGroups()
                .then((groups) => groups
                    .map(formatGroup)
                    .filter((group) => group.id)
                    .sort((left, right) => left.name.localeCompare(right.name, "uk-UA", {
                        numeric: true,
                        sensitivity: "base",
                    }))
                )
                .then((groups) => {
                    this.campaignGroupsCache = groups;
                    return groups;
                })
                .finally(() => {
                    this.campaignGroupsRequest = null;
                });
        }
        return this.campaignGroupsRequest;
    }


    async listCampaigns({ forceRefresh = false } = {}) {
        if (forceRefresh) this.campaignsCache = null;
        if (this.campaignsCache) return this.campaignsCache;
        if (!this.campaignsRequest) {
            this.campaignsRequest = this.keitaro.listAllCampaigns()
                .then((campaigns) => {
                    this.campaignsCache = campaigns;
                    return campaigns;
                })
                .finally(() => {
                    this.campaignsRequest = null;
                });
        }
        return this.campaignsRequest;
    }


    async getCampaignsReport({
        groupId = "all",
        availableGroupIds = [],
        datePreset = "today",
        forceRefresh = false,
    } = {}) {
        const list = await this.getCampaignsList({
            groupId,
            availableGroupIds,
            datePreset,
            forceRefresh,
        });
        const stats = await this.getCampaignStats({
            selectedGroupIds: list.selectedGroupIds,
            datePreset,
        });
        const statsById = new Map(stats.map((item) => [item.id, item]));
        return {
            ...list,
            campaigns: list.campaigns.map((campaign) => ({
                ...campaign,
                ...emptyCampaignStats(),
                ...(statsById.get(campaign.id) ?? {}),
            })),
        };
    }


    async getCampaignsList({
        groupId = "all",
        availableGroupIds = [],
        datePreset = "today",
        forceRefresh = false,
    } = {}) {
        const available = [...new Set(
            (Array.isArray(availableGroupIds) ? availableGroupIds : [])
                .map((id) => String(id ?? "").trim())
                .filter(Boolean)
        )];
        const [allGroups, allCampaigns] = await Promise.all([
            this.listCampaignGroups({ forceRefresh }),
            this.listCampaigns({ forceRefresh }),
        ]);
        const groups = allGroups
            .filter((group) => available.includes(group.id));
        const selectedGroupIds = groupId && groupId !== "all"
            ? groups.filter((group) => group.id === String(groupId)).map((group) => group.id)
            : groups.map((group) => group.id);

        if (selectedGroupIds.length === 0) {
            return {
                campaigns: [],
                groups,
                selectedGroupIds,
                datePreset,
                range: rangeFromPreset(datePreset),
            };
        }

        const groupNameById = new Map(
            groups.map((group) => [group.id, group.name])
        );
        const selectedSet = new Set(selectedGroupIds);
        const campaigns = allCampaigns
            .filter((campaign) => selectedSet.has(String(
                campaign?.group_id ?? campaign?.groupId ?? ""
            )))
            .map((campaign) => {
                const id = String(campaign?.id ?? "").trim();
                const groupKey = String(campaign?.group_id ?? campaign?.groupId ?? "");
                return {
                    id,
                    name: String(campaign?.name ?? "").trim() || "Без назви",
                    groupId: groupKey,
                    groupName: groupNameById.get(groupKey) || "",
                    state: campaignState(campaign?.state),
                };
            });

        return {
            campaigns,
            groups,
            selectedGroupIds,
            datePreset,
            range: rangeFromPreset(datePreset),
        };
    }


    async getCampaignStats({ selectedGroupIds = [], datePreset = "today" } = {}) {
        if (!Array.isArray(selectedGroupIds) || selectedGroupIds.length === 0) {
            return [];
        }

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

        return normalizeList(report).map((row) => {
            const id = String(row?.campaign_id ?? row?.campaignId ?? "").trim();
            if (!id) return null;
            return {
                id,
                clicks: numberOrZero(row.clicks),
                uniqueClicks: numberOrZero(row.campaign_unique_clicks ?? row.unique_clicks),
                bots: numberOrZero(row.bots),
                conversions: numberOrZero(row.conversions),
                sales: numberOrZero(row.sales),
                leads: numberOrZero(row.leads),
                rejected: numberOrZero(row.rejected),
                cr: numberOrZero(row.crs ?? row.cr),
                cost: numberOrZero(row.cost),
                revenue: numberOrZero(row.revenue),
                profit: numberOrZero(row.profit),
                roi: numberOrZero(row.roi),
                epc: numberOrZero(row.epc),
                cpc: numberOrZero(row.cpc),
            };
        }).filter(Boolean);
    }
}
