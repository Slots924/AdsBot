import assert from "node:assert/strict";

import refreshProxyIp from "../services/proxy/refreshProxyIp.js";


const proxy = {
    id: "proxy-001",
    type: "socks5",
    host: "proxy.example.com",
    port: "10000",
    refreshUrl: "https://provider.example/changeip/token",
};

let checks = 0;
const recovered = await refreshProxyIp(proxy, {
    httpClient: {
        async get(url) {
            assert.equal(url, proxy.refreshUrl);
            return { status: 200 };
        },
    },
    checkProxyFn: async () => {
        checks += 1;
        return checks >= 3
            ? { working: true, ip: "203.0.113.10" }
            : { working: false };
    },
    timeoutMs: 1000,
    pollIntervalMs: 1,
    initialDelayMs: 0,
});
assert.equal(recovered.working, true);
assert.equal(recovered.timedOut, false);
assert.equal(recovered.ip, "203.0.113.10");
assert.equal(checks, 3);

const timedOut = await refreshProxyIp(proxy, {
    httpClient: { async get() { return { status: 204 }; } },
    checkProxyFn: async () => ({ working: false }),
    timeoutMs: 12,
    pollIntervalMs: 4,
    initialDelayMs: 0,
});
assert.equal(timedOut.working, false);
assert.equal(timedOut.timedOut, true);
assert.equal(timedOut.ip, null);

await assert.rejects(refreshProxyIp({
    ...proxy,
    refreshUrl: "",
}, {
    httpClient: { async get() { return { status: 200 }; } },
    checkProxyFn: async () => ({ working: true }),
    initialDelayMs: 0,
}), { code: "PROXY_REFRESH_URL_MISSING" });

await assert.rejects(refreshProxyIp(proxy, {
    httpClient: {
        async get() {
            throw new Error("offline");
        },
    },
    checkProxyFn: async () => ({ working: true }),
    initialDelayMs: 0,
}), { code: "PROXY_REFRESH_REQUEST_FAILED" });

console.log("Перевірка зміни IP проксі пройшла успішно");
