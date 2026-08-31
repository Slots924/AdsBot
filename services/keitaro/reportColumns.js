const keitaroReportMetrics = [
    "clicks",
    "campaign_unique_clicks",
    "bots",
    "conversions",
    "sales",
    "leads",
    "rejected",
    "revenue",
    "cost",
    "profit",
    "roi",
    "crs",
    "epc",
    "cpc",
];


const keitaroColumnIds = [
    "id",
    "name",
    "group",
    "state",
    "clicks",
    "uniqueClicks",
    "bots",
    "conversions",
    "sales",
    "leads",
    "rejected",
    "cr",
    "cost",
    "revenue",
    "profit",
    "roi",
    "epc",
    "cpc",
];


const defaultKeitaroVisibleColumns = [
    "id",
    "name",
    "clicks",
    "conversions",
    "revenue",
];


const defaultKeitaroColumnWidths = {
    id: 88,
    name: 280,
    group: 160,
    state: 110,
    clicks: 100,
    uniqueClicks: 100,
    bots: 90,
    conversions: 120,
    sales: 100,
    leads: 100,
    rejected: 110,
    cr: 90,
    cost: 110,
    revenue: 110,
    profit: 110,
    roi: 90,
    epc: 90,
    cpc: 90,
};


const keitaroDatePresets = [
    "today",
    "yesterday",
    "last_7d",
    "last_30d",
    "maximum",
];


const keitaroPageSizes = [50, 100, 150, 200, 500];
const defaultKeitaroPageSize = 50;
const defaultKeitaroConcurrency = 20;
const keitaroConcurrencyMin = 1;
const keitaroConcurrencyMax = 50;


export {
    defaultKeitaroColumnWidths,
    defaultKeitaroConcurrency,
    defaultKeitaroPageSize,
    defaultKeitaroVisibleColumns,
    keitaroColumnIds,
    keitaroConcurrencyMax,
    keitaroConcurrencyMin,
    keitaroDatePresets,
    keitaroPageSizes,
    keitaroReportMetrics,
};
