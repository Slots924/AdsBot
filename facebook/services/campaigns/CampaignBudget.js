import { createValidationError } from "../../api/validation.js";

const zeroDecimalCurrencies = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
    "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function budgetToMinorUnits(value, currency) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw createValidationError(
            "Бюджет одного ad set має бути більшим за нуль",
            "CAMPAIGN_BUDGET_INVALID"
        );
    }
    const multiplier = zeroDecimalCurrencies.has(
        String(currency ?? "").toUpperCase()
    ) ? 1 : 100;
    return String(Math.round(amount * multiplier));
}

export function buildCampaignBudgetSettings(shareAdSetBudget, { budgetMode = "adset", dailyBudgetMinor } = {}) {
    const sharingEnabled = Boolean(shareAdSetBudget);
    const bidStrategy = { bid_strategy: "LOWEST_COST_WITHOUT_CAP" };
    // CBO задає бюджет та стратегію кампанії, незалежно від шерингу в шаблоні.
    if (budgetMode === "campaign") {
        return {
            campaign: { daily_budget: dailyBudgetMinor, ...bidStrategy, is_adset_budget_sharing_enabled: false },
            adSet: {},
        };
    }

    // За спільного розподілу ставки задає кампанія, інакше — кожен адсет.
    return {
        campaign: {
            is_adset_budget_sharing_enabled: sharingEnabled,
            ...(sharingEnabled ? bidStrategy : {}),
        },
        adSet: sharingEnabled ? {} : bidStrategy,
    };
}
