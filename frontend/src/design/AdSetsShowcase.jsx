import AdAccountsTab from "../tabs/AdAccountsTab.jsx";

const ok = (data) => Promise.resolve({ ok: true, data });
const account = { id: "act_100", accountId: "100", name: "Demo ad account", localName: "Робочий кабінет", currency: "USD", status: "active", isFavorite: true, timezoneName: "America/Los_Angeles", timezoneOffsetHoursUtc: -8, amountSpent: "1250" };
const campaigns = { cacheHit: true, listUpdatedAt: "2026-11-06T10:00:00Z", statisticsUpdatedAt: "2026-11-06T09:50:00Z", campaigns: [
    { id: "200", name: "Україна · Ліди · Основна кампанія", status: "ACTIVE", effectiveStatus: "ACTIVE", spend: 142.75, leads: 19, costPerLead: 7.51, ctr: 2.48, cpm: 6.20 },
    { id: "201", name: "Тест нових креативів", status: "PAUSED", effectiveStatus: "PAUSED", spend: 32.5, leads: 4, costPerLead: 8.12, ctr: 1.75, cpm: 7.1 },
] };
let data = { cacheHit: true, listUpdatedAt: "2026-11-06T10:00:00Z", statisticsUpdatedAt: "2026-11-06T09:50:00Z", adSets: [
    { id: "300", name: "Широка аудиторія · 25–55 · Основний креатив", status: "ACTIVE", effectiveStatus: "ACTIVE", dailyBudget: "2500", startTime: "2026-11-05T16:00:00Z", spend: 89.25, leads: 12, costPerLead: 7.44, ctr: 2.68, cpm: 5.9 },
    { id: "301", name: "Ретаргетинг · Відвідувачі за останні 30 днів", status: "PAUSED", effectiveStatus: "PAUSED", dailyBudget: "1500", startTime: "2026-11-05T16:00:00Z", spend: 53.5, leads: 7, costPerLead: 7.64, ctr: 2.11, cpm: 6.6 },
] };

export default function AdSetsShowcase() {
    window.adsBot = {
        getAdAccounts: () => ok([account]), getAdCampaigns: () => ok(campaigns), refreshAdCampaignData: () => ok(campaigns),
        getCampaignAdSets: () => ok(data), refreshCampaignAdSets: () => ok(data),
        refreshCampaignAdSetStatistics: () => ok(data),
        setAdSetStatus: async ({ adSetId, status }) => {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            data = { ...data, adSets: data.adSets.map((row) => row.id === adSetId ? { ...row, status, effectiveStatus: status } : row) };
            return { ok: true, data: { id: adSetId, status, effectiveStatus: status } };
        },
        deleteAdSet: ({ adSetId }) => {
            data = { ...data, adSets: data.adSets.map((row) => row.id === adSetId ? { ...row, status: "DELETED", effectiveStatus: "DELETED", spend: null, leads: null, costPerLead: null, cpm: null, ctr: null } : row) };
            return ok({ id: adSetId, status: "DELETED", data });
        },
        duplicateAdSet: (input) => {
            const copies = Array.from({ length: input.count }, (_, index) => ({ ...data.adSets[0], id: `demo-${index}`, name: `Копія ${index + 1}`, status: input.createActive ? "ACTIVE" : "PAUSED", effectiveStatus: input.createActive ? "IN_PROCESS" : "PAUSED" }));
            data = { ...data, adSets: [...data.adSets, ...copies] };
            return ok({ taskId: "demo-duplicate-task" });
        },
    };
    return <main style={{ padding: 24 }}><AdAccountsTab selectedAccount={{ accountKey: "demo", status: "active" }} workspaceAccounts={[account]} selectedId={account.id} setSelectedId={() => {}} onError={() => {}} /></main>;
}
