export default function toAdsPowerProxyConfig(proxy = {}) {
    const type = String(proxy.proxy_type ?? proxy.type ?? "")
        .trim()
        .toLowerCase();
    if (type === "no_proxy" || proxy.proxy_soft === "no_proxy") {
        return {
            proxy_soft: "no_proxy",
            proxy_type: "no_proxy",
        };
    }

    if (proxy.proxy_host && proxy.proxy_type) {
        return {
            proxy_soft: proxy.proxy_soft || "other",
            proxy_type: proxy.proxy_type,
            proxy_host: proxy.proxy_host,
            proxy_port: String(proxy.proxy_port ?? ""),
            proxy_user: proxy.proxy_user || "",
            proxy_password: proxy.proxy_password || "",
            proxy_url: proxy.proxy_url || "",
        };
    }

    return {
        proxy_soft: "other",
        proxy_type: type,
        proxy_host: String(proxy.host ?? ""),
        proxy_port: String(proxy.port ?? ""),
        proxy_user: proxy.username || "",
        proxy_password: proxy.password || "",
        proxy_url: proxy.refreshUrl || "",
    };
}
