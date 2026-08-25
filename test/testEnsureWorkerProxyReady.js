import assert from "node:assert/strict";

import ensureWorkerProxyReady from "../services/proxy/ensureWorkerProxyReady.js";
import toAdsPowerProxyConfig from "../services/proxy/toAdsPowerProxyConfig.js";


const proxy = {
    id: "proxy-001",
    type: "socks5",
    host: "proxy.example.com",
    port: "10000",
    username: "user",
    password: "secret",
    refreshUrl: "https://provider.example/changeip/token",
};

const refreshed = await ensureWorkerProxyReady(proxy, {
    timeoutMs: 1000,
    refreshProxyIpFn: async (item, options) => {
        assert.equal(item.id, "proxy-001");
        assert.equal(options.timeoutMs, 1000);
        return { working: true, timedOut: false, ip: "203.0.113.10" };
    },
});
assert.equal(refreshed.working, true);
assert.equal(refreshed.ip, "203.0.113.10");

const withoutRefresh = await ensureWorkerProxyReady({
    ...proxy,
    refreshUrl: "",
}, {
    checkProxyFn: async () => ({ working: false, error: "down" }),
});
assert.equal(withoutRefresh.working, false);
assert.equal(withoutRefresh.timedOut, false);

const failedRefresh = await ensureWorkerProxyReady(proxy, {
    refreshProxyIpFn: async () => {
        throw new Error("Не вдалося надіслати запит на зміну IP");
    },
});
assert.equal(failedRefresh.working, false);

assert.deepEqual(toAdsPowerProxyConfig(proxy), {
    proxy_soft: "other",
    proxy_type: "socks5",
    proxy_host: "proxy.example.com",
    proxy_port: "10000",
    proxy_user: "user",
    proxy_password: "secret",
    proxy_url: "https://provider.example/changeip/token",
});
assert.deepEqual(toAdsPowerProxyConfig({ type: "no_proxy" }), {
    proxy_soft: "no_proxy",
    proxy_type: "no_proxy",
});

console.log("Перевірка готовності проксі воркера пройшла успішно");
