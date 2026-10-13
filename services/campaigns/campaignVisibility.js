export function isUnavailableCampaign(campaign) {
    return [campaign.status, campaign.effectiveStatus].some((status) => (
        ["DELETED", "ARCHIVED"].includes(String(status ?? "").toUpperCase())
    ));
}

export function clearUnavailableCampaignStatistics(campaign) {
    if (!isUnavailableCampaign(campaign)) return campaign;
    return {
        ...campaign,
        leads: null,
        spend: null,
        costPerLead: null,
        impressions: null,
        clicks: null,
        cpm: null,
        ctr: null,
        metaLeads: null,
        leadSource: null,
        leadSyncStatus: null,
    };
}

export function visibleCampaigns(campaigns = [], includeDeleted = false) {
    return campaigns
        // Збережені копії залишаються в кеші, але успішний список визначає видимість.
        .filter((campaign) => !campaign.missingFromFullList
            && (!campaign.missingFromActiveList || (includeDeleted && isUnavailableCampaign(campaign))))
        .filter((campaign) => includeDeleted || !isUnavailableCampaign(campaign))
        .map(clearUnavailableCampaignStatistics);
}
