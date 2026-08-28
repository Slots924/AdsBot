export const keitaroFilterTypes = [
    { id: "country", label: "Країни", payload: "country" },
    { id: "os", label: "Операційні системи", payload: "list" },
    { id: "bot", label: "Бот", payload: "none" },
    { id: "proxy", label: "Проксі", payload: "none" },
    { id: "device_type", label: "Тип пристрою", payload: "list" },
    { id: "browser", label: "Браузер", payload: "list" },
    { id: "language", label: "Мова", payload: "list" },
    { id: "city", label: "Місто", payload: "list" },
    { id: "region", label: "Регіон", payload: "list" },
    { id: "isp", label: "Інтернет-провайдер", payload: "list" },
    { id: "ip", label: "IP", payload: "text" },
    { id: "referrer", label: "Реферер", payload: "text" },
    { id: "uniqueness", label: "Унікальність", payload: "none" },
    { id: "ipv6", label: "IPv6", payload: "none" },
    { id: "empty_referrer", label: "Порожній реферер", payload: "none" },
    { id: "connection_type", label: "Тип з'єднання", payload: "list" },
    { id: "user_agent", label: "User-Agent", payload: "text" },
    { id: "keyword", label: "Ключове слово", payload: "text" },
    { id: "sub_id_1", label: "Sub ID 1", payload: "text" },
];

export const keitaroStreamTypes = [
    { id: "regular", label: "Звичайний" },
    { id: "forced", label: "Перехоплюючий" },
    { id: "default", label: "Замикаючий" },
];

export const keitaroStreamSchemas = [
    { id: "landings", label: "Лендінги та офери" },
    { id: "redirects", label: "Пряма URL-адреса" },
    { id: "action", label: "Дія" },
];

export function filterLabel(name) {
    return keitaroFilterTypes.find((item) => item.id === name)?.label || name;
}

export function payloadKind(name) {
    return keitaroFilterTypes.find((item) => item.id === name)?.payload || "list";
}

export function payloadText(payload) {
    if (Array.isArray(payload)) return payload.join("\n");
    if (payload == null) return "";
    return typeof payload === "object" ? JSON.stringify(payload) : String(payload);
}

export function parsePayload(name, text) {
    const kind = payloadKind(name);
    if (kind === "none") return null;
    if (kind === "text") return String(text ?? "").trim() || null;
    return String(text ?? "")
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}
