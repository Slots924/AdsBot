import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";


export default function createProxyAgent(proxy) {
    const type = String(proxy?.type ?? "").toLowerCase();
    const host = String(proxy?.host ?? "").trim();
    const port = String(proxy?.port ?? "").trim();

    if (!host || !port) {
        throw new Error("Проксі не містить host або port");
    }

    const username = encodeURIComponent(proxy?.username ?? "");
    const password = encodeURIComponent(proxy?.password ?? "");
    const authorization = proxy?.username
        ? `${username}:${password}@`
        : "";
    const proxyUrl = `${type}://${authorization}${host}:${port}`;

    if (type === "socks5") {
        return new SocksProxyAgent(proxyUrl);
    }

    if (type === "http" || type === "https") {
        return new HttpsProxyAgent(proxyUrl);
    }

    throw new Error(`Тип проксі "${type}" не підтримується`);
}
