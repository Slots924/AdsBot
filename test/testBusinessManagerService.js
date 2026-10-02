import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import BusinessManagerService from "../services/gui/BusinessManagerService.js";
import RemoteDataCacheStore from "../services/gui/RemoteDataCacheStore.js";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import createFacebookApiClients from "../facebook/api/createFacebookApiClients.js";
import { businessAssetTasks } from "../facebook/api/businessAccess.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-bm-test-"));
try {
    const cacheFile = path.join(directory, "cache.json");
    const cache = new RemoteDataCacheStore({ cacheFile });
    let snapshot = {
        users: [{ id: "11", name: "Person", role: "EMPLOYEE" }, { id: "12", name: "Admin", role: "ADMIN" }], pending: [],
        pages: [{ id: "21", name: "Page", assignedUsers: [{ id: "11", tasks: businessAssetTasks.pages }] }],
        adAccounts: [{ id: "act_31", name: "Account", ownership: "shared", assignedUsers: [{ id: "11", tasks: ["ANALYZE"] }] }],
    };
    const calls = [], progress = [], logs = [];
    let refreshFails = false, failedUser = "12", unknown = false, creations = 0;
    const client = {
        getBusinessManagers: async () => [{ id: "1", name: "Business" }],
        getBusinessManagementSection: async (_id, section) => {
            if (refreshFails) throw new Error("read failed");
            if (section === "pixels") return { pixels: [{ id: "41", name: "Pixel", sharedAccounts: [{ id: "act_31" }] }], adAccounts: snapshot.adAccounts };
            return structuredClone(snapshot);
        },
        assignBusinessUserToAsset: async (operation) => {
            calls.push(operation);
            if (operation.userId === failedUser) throw Object.assign(new Error("permission denied access_token=hidden"), { code: unknown ? "FACEBOOK_BUSINESS_OUTCOME_UNKNOWN" : "FACEBOOK_API_ERROR" });
            const asset = [...snapshot.pages, ...snapshot.adAccounts].find((item) => item.id === operation.assetId);
            asset.assignedUsers = [...asset.assignedUsers.filter((user) => user.id !== operation.userId), { id: operation.userId, tasks: operation.tasks }];
            return { success: true };
        },
        inviteBusinessUser: async (operation) => { calls.push(operation); refreshFails = true; return { id: "15" }; },
        removeBusinessUserFromAsset: async (operation) => { calls.push(operation); return true; },
        setBusinessPixelAccount: async (operation) => { calls.push(operation); return true; },
        removeSharedBusinessAdAccount: async (operation) => { calls.push(operation); return true; },
    };
    const service = new BusinessManagerService({
        cache, listAccounts: async () => [{ accountKey: "system-001", kind: "system" }, { accountKey: "api-001", kind: "api" }],
        createClient: async () => { creations += 1; return client; },
        logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
        onProgress: (value) => progress.push(value),
    });
    const input = { accountKey: "system-001", businessId: "1", section: "users" };
    assert.equal(await service.execute({ ...input, action: "section" }), null);
    assert.equal(creations, 0);
    await assert.rejects(service.execute({ ...input, action: "list", accountKey: "api-001", force: true }), /Оберіть/);
    const first = await service.execute({ ...input, action: "grantAll" });
    assert.equal(first.total, 3);
    assert.equal(first.successful, 1);
    assert.equal(first.people, 1);
    assert.equal(first.failed.length, 2);
    assert.equal(progress.length, 3);
    assert.equal(first.failed[0].error.message.includes("hidden"), false);
    assert.equal(calls.some((item) => item.assetId === "21" && item.userId === "11"), false);
    failedUser = "";
    const retried = await service.execute({ ...input, action: "grantAll", retryTargets: first.failed.map((item) => item.key) });
    assert.equal(retried.total, 2);
    assert.equal(retried.successful, 2);
    assert.equal((await service.execute({ ...input, action: "grantAll" })).total, 0);

    const before = calls.length;
    await assert.rejects(service.execute({ ...input, action: "userAssets", kind: "pages", userId: "11", originalIds: [], selectedIds: [] }), /змінилися/);
    await assert.rejects(service.execute({ ...input, action: "userAssets", kind: "pages", userId: "11", originalIds: ["21"], selectedIds: ["999"] }), /більше не доступний/);
    await assert.rejects(service.execute({ ...input, action: "userAssets", kind: "pages", userId: "999", originalIds: [], selectedIds: [] }), /відсутній/);
    assert.equal(calls.length, before);
    const removed = await service.execute({ ...input, action: "userAssets", kind: "pages", userId: "11", originalIds: ["21"], selectedIds: [] });
    assert.equal(removed.successful, 1);
    const pixels = await service.execute({ ...input, action: "pixelAccounts", pixelId: "41", originalIds: ["31"], selectedIds: [] });
    assert.equal(pixels.successful, 1);
    assert.equal(calls.at(-1).enabled, false);
    const invite = await service.execute({ ...input, action: "invite", email: "person@example.com", role: "ADMIN" });
    assert.equal(invite.invited, true);
    assert.equal(invite.snapshot, null);
    assert.equal(invite.refreshError.message, "read failed");
    assert.equal(calls.at(-1).financePermission, "FINANCE_EDITOR");
    assert.equal(calls.at(-1).useTasks, true);
    assert.equal((await service.execute({ ...input, action: "section" })).value, null);
    refreshFails = false;
    snapshot.adAccounts[0].ownership = "owned";
    await assert.rejects(service.execute({ ...input, action: "removeAccount", assetId: "act_31" }), /не підтримує/);
    snapshot.pages[0].assignedUsers = [];
    failedUser = "11"; unknown = true;
    const uncertain = await service.execute({ ...input, action: "grantAll" });
    assert.equal(uncertain.failed[0].retryable, false);
    const originalRead = client.getBusinessManagementSection;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    client.getBusinessManagementSection = async (...args) => { await gate; return originalRead(...args); };
    const running = service.execute({ ...input, action: "grantAll" });
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(service.execute({ ...input, businessId: 1, action: "grantAll" }), /уже виконується/);
    release(); await running;
    client.getBusinessManagementSection = originalRead;
    await service.execute({ ...input, action: "select" });
    assert.equal((await new RemoteDataCacheStore({ cacheFile }).getBusinessData("preferences")).value.businessId, "1");
    await cache.setBusinessData("secret-test", { accessToken: "hidden", cookie: "hidden", proxy: "hidden", note: "access_token=hidden", name: "BM" });
    const disk = await readFile(cacheFile, "utf8");
    assert.equal(disk.includes("hidden"), false);

    const graphCalls = [];
    const graph = new FacebookGraphApi({ accountKey: "mock", accessToken: "mock", userAgent: "UA", proxyHttpClient: { request: async (config, options) => {
        graphCalls.push({ config, options });
        if (config.method !== "get") return { data: { success: true } };
        const endpoint = new URL(config.url).pathname.replace("/v26.0", "");
        const edges = {
            "/1/business_users": [{ id: "11", role: "EMPLOYEE" }, { id: "99", role: "ADMIN" }, { id: "98", role: "PARTNER_CENTER_ADMIN" }],
            "/1/system_users": [{ id: "99" }], "/1/owned_pages": [{ id: "21", name: "Page" }],
            "/1/client_pages": [{ id: "21", name: "Shared duplicate" }],
        };
        return { data: { data: edges[endpoint] ?? [] } };
    } } });
    const graphData = await graph.getBusinessManagementSection("1", "users");
    assert.deepEqual(graphData.users.map((user) => user.id), ["11"]);
    assert.equal(graphData.pages.length, 1);
    assert.equal(graphData.pages[0].ownership, "owned");
    assert.equal(graphCalls.some(({ config }) => /campaigns|adsets/.test(config.url)), false);
    await graph.inviteBusinessUser({ businessId: "1", email: "a@example.com", role: "ADMIN", useTasks: true });
    const invitation = graphCalls.at(-1);
    assert.deepEqual(JSON.parse(invitation.config.data.get("tasks")), ["ADMIN", "FINANCE_EDITOR"]);
    assert.equal(invitation.config.data.has("finance_permission"), false);
    assert.equal(invitation.options.retryOnConnectionError, false);
    await graph.setBusinessPixelAccount({ pixelId: "41", accountId: "act_31", businessId: "1", enabled: false });
    assert.equal(graphCalls.at(-1).config.method, "delete");
    assert.equal(graphCalls.at(-1).config.data.get("account_id"), "31");
    await assert.rejects(graph.getBusinessManagementSection("../1", "users"), /Некоректний/);

    const accountsFilePath = path.join(directory, "accounts.json"), bmFilePath = path.join(directory, "bm.json"), systemUsersFilePath = path.join(directory, "systems.json"), proxiesFilePath = path.join(directory, "proxies.json");
    await writeFile(accountsFilePath, '{"accounts":[]}');
    await writeFile(bmFilePath, '{"accounts":[]}');
    await writeFile(systemUsersFilePath, JSON.stringify({ accounts: [{ accountKey: "system-001", accessToken: "mock", userAgent: "UA" }] }));
    await writeFile(proxiesFilePath, JSON.stringify({ proxies: [
        { id: "proxy-1", type: "http", host: "first.example", port: "8080" },
        { id: "proxy-2", type: "http", host: "second.example", port: "8080" },
        { id: "proxy-3", type: "http", host: "third.example", port: "8080" },
    ] }));
    const hosts = [], checks = [];
    const clients = await createFacebookApiClients({ accountsFilePath, bmFilePath, systemUsersFilePath, proxiesFilePath, businessOnly: true, onlyAccountKey: "system-001",
        httpClient: { request: async (config) => { const host = config.httpsAgent.proxy.hostname; hosts.push(host); if (host === "first.example") throw Object.assign(new Error("offline"), { code: "ECONNREFUSED" }); return { data: { id: "11" } }; } },
        checkProxyFn: async (proxy) => { checks.push(proxy.id); return { working: proxy.id === "proxy-3" }; },
    });
    await clients.get("system-001").getMe();
    assert.deepEqual(hosts, ["first.example", "third.example"]);
    assert.deepEqual(checks, ["proxy-2", "proxy-3"]);
    console.log("Перевірки БМ, кешу, доступів, Graph payload і проксі системного юзера пройшли");
} finally {
    await rm(directory, { recursive: true, force: true });
}
