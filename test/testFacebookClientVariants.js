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
    console.log("Перевірка BM і прив’язаної проксі пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
