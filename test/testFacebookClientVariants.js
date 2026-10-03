import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import createFacebookApiClients from "../facebook/api/createFacebookApiClients.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-client-variants-"));
try {
    const accountsFilePath = path.join(directory, "accounts.json");
    const bmFilePath = path.join(directory, "businessManagers.json");
    const proxiesFilePath = path.join(directory, "proxies.json");
    await writeFile(accountsFilePath, JSON.stringify({ accounts: [
        { accountKey: "account-001", name: "API", userAgent: "UA", accessToken: "token", cookie: "c_user=1", proxyId: "proxy-002" },
    ] }));
    await writeFile(bmFilePath, JSON.stringify({ accounts: [
        { accountKey: "bm-001", name: "BM", userAgent: "UA", accessToken: "token", cookie: "c_user=2" },
    ] }));
    await writeFile(proxiesFilePath, JSON.stringify({ proxies: [
        { id: "proxy-001", type: "http", host: "pool.example", port: "8080" },
        { id: "proxy-002", type: "http", host: "fixed.example", port: "8080" },
    ] }));
    const hosts = [];
    const httpClient = { request: async (config) => {
        hosts.push(config.httpsAgent.proxy.hostname);
        return { data: { id: "1", name: "User" } };
    } };
    const clients = await createFacebookApiClients({ accountsFilePath, bmFilePath, proxiesFilePath, httpClient });
    assert.deepEqual([...clients.keys()], ["account-001", "bm-001"]);
    await clients.get("account-001").getMe();
    await clients.get("bm-001").getMe();
    assert.deepEqual(hosts, ["fixed.example", "pool.example"]);

    const systemUsersFilePath = path.join(directory, "systems.json");
    const proxyConfig = [
        { id: "proxy-private", type: "http", host: "private.example", port: "8080", isPublic: false },
        { id: "proxy-001", type: "http", host: "pool.example", port: "8080" },
        { id: "proxy-002", type: "http", host: "fixed.example", port: "8080", isPublic: false },
        { id: "proxy-public", type: "http", host: "public.example", port: "8080", isPublic: true },
    ];
    await writeFile(proxiesFilePath, JSON.stringify({ proxies: proxyConfig }));
    const options = { accountsFilePath, bmFilePath, systemUsersFilePath, proxiesFilePath, httpClient };
    for (const kind of ["api", "bm", "system"]) {
        for (const bound of [false, true]) {
            const account = { accountKey: "client", kind, userAgent: "UA", accessToken: "token", cookie: "c_user=1", proxyId: bound ? "proxy-002" : "" };
            await writeFile(accountsFilePath, JSON.stringify({ accounts: kind === "api" ? [account] : [] }));
            await writeFile(bmFilePath, JSON.stringify({ accounts: kind === "bm" ? [account] : [] }));
            await writeFile(systemUsersFilePath, JSON.stringify({ accounts: kind === "system" ? [account] : [] }));
            hosts.length = 0;
            const checks = [];
            const isolated = await createFacebookApiClients({ ...options,
                httpClient: { request: async (config) => {
                    const host = config.httpsAgent.proxy.hostname;
                    hosts.push(host);
                    if (host !== "public.example") throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" });
                    return { data: { id: "1" } };
                } },
                checkProxyFn: async (proxy) => { checks.push(proxy.id); return { working: true }; },
            });
            if (bound) {
                await assert.rejects(isolated.get("client").getMe(), { code: "PROXY_POOL_EXHAUSTED" });
                assert.deepEqual(hosts, ["fixed.example"]);
                assert.deepEqual(checks, []);
            } else {
                await isolated.get("client").getMe();
                assert.deepEqual(hosts, ["pool.example", "public.example"]);
                assert.deepEqual(checks, ["proxy-public"]);
            }
        }
    }
    await writeFile(proxiesFilePath, JSON.stringify({ proxies: proxyConfig.filter((proxy) => proxy.isPublic === false) }));
    hosts.length = 0;
    const privateClients = await createFacebookApiClients(options);
    await privateClients.get("client").getMe();
    assert.deepEqual(hosts, ["fixed.example"]);
    await writeFile(systemUsersFilePath, JSON.stringify({ accounts: [{ accountKey: "client", userAgent: "UA", accessToken: "token" }] }));
    await writeFile(bmFilePath, JSON.stringify({ accounts: [{ accountKey: "bound", userAgent: "UA", accessToken: "token", cookie: "c_user=2", proxyId: "proxy-002" }] }));
    const emptyPoolClients = await createFacebookApiClients(options);
    hosts.length = 0;
    await assert.rejects(emptyPoolClients.get("client").getMe(), /Немає загальнодоступних проксі/);
    assert.deepEqual(hosts, []);
    await emptyPoolClients.get("bound").getMe();
    assert.deepEqual(hosts, ["fixed.example"]);
    console.log("Перевірка BM і прив’язаної проксі пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
