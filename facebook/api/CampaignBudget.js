export function buildCampaignBudgetSettings(shareAdSetBudget) {
    const sharingEnabled = Boolean(shareAdSetBudget);
    const bidStrategy = { bid_strategy: "LOWEST_COST_WITHOUT_CAP" };

    // За спільного розподілу ставки задає кампанія, інакше — кожен адсет.
    return {
        campaign: {
            is_adset_budget_sharing_enabled: sharingEnabled,
            ...(sharingEnabled ? bidStrategy : {}),
        },
        adSet: sharingEnabled ? {} : bidStrategy,
    };
}
