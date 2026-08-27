export const keitaroDatePresets = [
    { id: "today", label: "Сьогодні" },
    { id: "yesterday", label: "Учора" },
    { id: "last_7d", label: "7 днів" },
    { id: "last_30d", label: "30 днів" },
    { id: "maximum", label: "Весь час" },
];


export const keitaroColumns = [
    { id: "id", label: "ID", type: "id", width: 88 },
    { id: "name", label: "Назва кампанії", type: "text", width: 280 },
    { id: "group", label: "Група", type: "text", width: 160 },
    { id: "state", label: "Статус", type: "state", width: 110 },
    { id: "clicks", label: "Кліки", type: "number", width: 100 },
    { id: "uniqueClicks", label: "Уніки", type: "number", width: 100 },
    { id: "bots", label: "Боти", type: "number", width: 90 },
    { id: "conversions", label: "Конверсії", type: "number", width: 120 },
    { id: "sales", label: "Продажі", type: "number", width: 100 },
    { id: "leads", label: "Ліди", type: "number", width: 100 },
    { id: "rejected", label: "Rejected", type: "number", width: 110 },
    { id: "cr", label: "CR", type: "percent", width: 90 },
    { id: "cost", label: "Витрати", type: "money", width: 110 },
    { id: "revenue", label: "Дохід", type: "money", width: 110 },
    { id: "profit", label: "Прибуток", type: "money", width: 110 },
    { id: "roi", label: "ROI", type: "percent", width: 90 },
    { id: "epc", label: "EPC", type: "money", width: 90 },
    { id: "cpc", label: "CPC", type: "money", width: 90 },
];


export function visibleKeitaroColumns(order, visible) {
    const visibleSet = new Set((visible ?? []).map(String));
    return (order ?? [])
        .map((id) => keitaroColumns.find((column) => column.id === id))
        .filter((column) => column && visibleSet.has(column.id));
}


export function campaignField(campaign, columnId) {
    if (columnId === "group") return campaign.groupName || "";
    if (columnId === "state") return campaign.state === "active" ? "Увімкнено" : "Пауза";
    return campaign[columnId];
}


export function sortKeitaroCampaigns(campaigns, sort) {
    const column = sort?.column || "clicks";
    const direction = sort?.direction === "asc" ? 1 : -1;
    return [...campaigns].sort((left, right) => {
        const leftValue = campaignField(left, column);
        const rightValue = campaignField(right, column);
        if (typeof leftValue === "number" && typeof rightValue === "number") {
            return (leftValue - rightValue) * direction;
        }
        return String(leftValue ?? "").localeCompare(
            String(rightValue ?? ""),
            "uk-UA",
            { numeric: true, sensitivity: "base" }
        ) * direction;
    });
}


export function formatKeitaroValue(column, value) {
    if (column.id === "state") {
        return value === "active" ? "Увімкнено" : "Пауза";
    }
    if (value === null || value === undefined || value === "") return "—";
    if (column.type === "number") {
        return new Intl.NumberFormat("uk-UA").format(value);
    }
    if (column.type === "money") {
        return new Intl.NumberFormat("uk-UA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value);
    }
    if (column.type === "percent") {
        return `${new Intl.NumberFormat("uk-UA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(value)}%`;
    }
    return String(value);
}
