const supportedProxyTypes = new Set([
    "socks5",
    "http",
    "https",
    "no_proxy",
]);


export function createProxyError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


export function normalizeAdsPowerId(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const adsPowerId = Number(value);
    if (!Number.isInteger(adsPowerId) || adsPowerId < 0) {
        throw createProxyError(
            "AdsPower ID має бути цілим числом",
            "PROXY_ADSPOWER_ID_INVALID"
        );
    }

    return adsPowerId;
}


export function normalizeRefreshUrl(value) {
    const refreshUrl = String(value ?? "").trim();
    if (!refreshUrl) return "";

    let parsed;
    try {
        parsed = new URL(refreshUrl);
    } catch {
        throw createProxyError(
            "Посилання для зміни IP має бути коректним URL",
            "PROXY_REFRESH_URL_INVALID"
        );
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw createProxyError(
            "Посилання для зміни IP має починатися з http або https",
            "PROXY_REFRESH_URL_INVALID"
        );
    }

    return refreshUrl;
}


export function serializeStoredProxy(proxy) {
    return {
        id: proxy.id,
        adsPowerId: proxy.adsPowerId ?? null,
        name: proxy.name ?? "",
        type: proxy.type,
        host: proxy.host,
        port: String(proxy.port),
        username: proxy.username ?? "",
        password: proxy.password ?? "",
        refreshUrl: proxy.refreshUrl ?? "",
    };
}


export function safeStoredProxy(proxy) {
    return {
        id: proxy.id,
        adsPowerId: proxy.adsPowerId ?? null,
        name: proxy.name ?? "",
        type: proxy.type,
        host: proxy.host,
        port: String(proxy.port),
        hasUsername: Boolean(String(proxy.username ?? "").trim()),
        hasPassword: Boolean(String(proxy.password ?? "").trim()),
        hasRefreshUrl: Boolean(String(proxy.refreshUrl ?? "").trim()),
    };
}


export default function normalizeStoredProxy(proxy, index = 0) {
    const id = String(proxy?.id ?? "").trim();
    const type = String(proxy?.type ?? "").trim().toLowerCase();
    const host = String(proxy?.host ?? "").trim();
    const port = String(proxy?.port ?? "").trim();
    const label = id || `проксі ${index + 1}`;

    if (!id) {
        throw createProxyError(
            `Проксі ${index + 1} не містить id`,
            "PROXY_ID_REQUIRED"
        );
    }

    if (!supportedProxyTypes.has(type)) {
        throw createProxyError(
            `Тип проксі "${type}" не підтримується`,
            "PROXY_TYPE_INVALID"
        );
    }

    if (type === "no_proxy") {
        return serializeStoredProxy({
            id,
            adsPowerId: normalizeAdsPowerId(proxy?.adsPowerId),
            name: String(proxy?.name ?? "").trim(),
            type,
            host: "",
            port: "",
            username: "",
            password: "",
            refreshUrl: "",
        });
    }

    if (!host) {
        throw createProxyError(
            `Проксі "${label}" не містить host`,
            "PROXY_HOST_REQUIRED"
        );
    }

    const numericPort = Number(port);
    if (
        !Number.isInteger(numericPort)
        || numericPort < 1
        || numericPort > 65535
    ) {
        throw createProxyError(
            `Проксі "${label}" містить некоректний port`,
            "PROXY_PORT_INVALID"
        );
    }

    return serializeStoredProxy({
        id,
        adsPowerId: normalizeAdsPowerId(proxy?.adsPowerId),
        name: String(proxy?.name ?? "").trim(),
        type,
        host,
        port,
        username: String(proxy?.username ?? ""),
        password: String(proxy?.password ?? ""),
        refreshUrl: normalizeRefreshUrl(proxy?.refreshUrl),
    });
}
