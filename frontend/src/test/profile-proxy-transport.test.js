import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import AdsPowerProfileProxy from "../../../services/proxy/AdsPowerProfileProxy.js";
import ProfileProxyHttpClient from "../../../services/proxy/ProfileProxyHttpClient.js";
import FacebookAccountManager from "../../../facebook/accounts/FacebookAccountManager.js";
import createFacebookApiClients from "../../../facebook/api/createFacebookApiClients.js";

const temporaryDirectories = [];
afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const proxyConfig = (host = "profile.example") => ({ proxy_type: "http", proxy_host: host,
    proxy_port: "8080", proxy_user: "fixture-user", proxy_password: "fixture-password" });
const snapshot = (host = "cached.example") => ({ profileNo: "123", updatedAt: "2026-10-11T00:00:00Z",
    proxy: { id: "profile-123", type: "http", host, port: "8080" } });

async function setup({ cached, proxyMode = "profile", kind = "api" } = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-profile-proxy-"));
    temporaryDirectories.push(directory);
    const accountsFile = path.join(directory, "accounts.json");
    const accountKey = kind === "bm" ? "bm-001" : "account-001";
    const account = { accountKey, kind, name: "Fixture", adsPowerProfileNo: "123", proxyMode,
        accessToken: "fixture-token", userAgent: "fixture-agent", cookie: "c_user=fixture", ...(cached ? { adsPowerProxy: cached } : {}) };
    await writeFile(accountsFile, JSON.stringify({ accounts: [account] }));
    const accountManager = new FacebookAccountManager({ accountsFile, kind });
    const adsPower = { getProfileByNo: vi.fn().mockResolvedValue({ profile_id: "id-123", user_proxy_config: proxyConfig() }) };
    const service = new AdsPowerProfileProxy({ accountManager, adsPower });
    const httpClient = { request: vi.fn().mockResolvedValue({ data: { id: "post-fixture" } }) };
    const transport = new ProfileProxyHttpClient({ accountKey, profileProxyService: service, httpClient });
    return { directory, accountsFile, accountKey, accountManager, adsPower, service, transport, httpClient };
}

describe("Транспорт проксі AdsPower-профілю", () => {
    it("отримує та зберігає проксі перед першим Facebook-запитом", async () => {
        const state = await setup();
        state.httpClient.request.mockImplementation(async (config) => {
            const stored = await state.accountManager.getAdsPowerProxyState(state.accountKey);
            expect(stored.adsPowerProxy.proxy.host).toBe("profile.example");
            expect(config.httpAgent).toBe(config.httpsAgent);
            expect(config.httpAgent.proxy.hostname).toBe("profile.example");
            expect(config.proxy).toBe(false);
            return { data: { id: "post-fixture" } };
        });
        await state.transport.request({ method: "post", url: "https://graph.facebook.com/fixture/feed" });
        expect(state.adsPower.getProfileByNo).toHaveBeenCalledWith("123");
        const [safe] = await state.accountManager.list();
        expect(safe.hasAdsPowerProxy).toBe(true);
        expect(safe).not.toHaveProperty("adsPowerProxy");
        expect(JSON.stringify(safe)).not.toContain("fixture-password");
    });

    it("повторно використовує збережену проксі після перезапуску транспорту", async () => {
        const state = await setup({ cached: snapshot() });
        await state.transport.get("https://graph.facebook.com/fixture");
        expect(state.adsPower.getProfileByNo).not.toHaveBeenCalled();
        expect(state.httpClient.request.mock.calls[0][0].httpsAgent.proxy.hostname).toBe("cached.example");
    });

    it("паралельні запити очікують одного отримання проксі", async () => {
        const state = await setup();
        let release;
        state.adsPower.getProfileByNo.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const requests = Array.from({ length: 4 }, () => state.transport.get("https://graph.facebook.com/fixture"));
        await vi.waitFor(() => expect(state.adsPower.getProfileByNo).toHaveBeenCalledTimes(1));
        expect(state.httpClient.request).not.toHaveBeenCalled();
        release({ user_proxy_config: proxyConfig() });
        await Promise.all(requests);
        expect(state.httpClient.request).toHaveBeenCalledTimes(4);
    });

    it("примусове оновлення змінює проксі наявного транспорту", async () => {
        const state = await setup({ cached: snapshot() });
        await state.transport.get("https://graph.facebook.com/fixture");
        state.adsPower.getProfileByNo.mockResolvedValue({ user_proxy_config: proxyConfig("updated.example") });
        await state.service.refresh(state.accountKey);
        await state.transport.get("https://graph.facebook.com/fixture");
        expect(state.httpClient.request.mock.calls[1][0].httpsAgent.proxy.hostname).toBe("updated.example");
    });

    it.each([null, { proxy_type: "no_proxy", proxy_soft: "no_proxy" }, { proxy_type: "http" }])("без придатної проксі не надсилає запит до Facebook (%j)", async (config) => {
        const state = await setup();
        state.adsPower.getProfileByNo.mockResolvedValue({ user_proxy_config: config });
        await expect(state.transport.get("https://graph.facebook.com/fixture")).rejects.toThrow();
        expect(state.httpClient.request).not.toHaveBeenCalled();
    });

    it("після помилки AdsPower повторює отримання на наступному запиті", async () => {
        const state = await setup();
        state.adsPower.getProfileByNo.mockRejectedValueOnce(new Error("AdsPower недоступний"));
        await expect(state.transport.get("https://graph.facebook.com/fixture")).rejects.toThrow("AdsPower недоступний");
        expect(state.httpClient.request).not.toHaveBeenCalled();
        await state.transport.get("https://graph.facebook.com/fixture");
        expect(state.adsPower.getProfileByNo).toHaveBeenCalledTimes(2);
    });

    it("невдале оновлення не залишає стару проксі для наступних запитів", async () => {
        const state = await setup({ cached: snapshot() });
        state.adsPower.getProfileByNo.mockRejectedValue(new Error("AdsPower недоступний"));
        await expect(state.service.refresh(state.accountKey)).rejects.toThrow();
        await expect(state.transport.get("https://graph.facebook.com/fixture")).rejects.toThrow();
        expect(state.httpClient.request).not.toHaveBeenCalled();
    });

    it("зміна номера профілю видаляє збережену проксі", async () => {
        const state = await setup({ cached: snapshot() });
        await state.accountManager.update(state.accountKey, { adsPowerProfileNo: "456" });
        expect((await state.accountManager.getAdsPowerProxyState(state.accountKey)).adsPowerProxy).toBeUndefined();
        await state.transport.get("https://graph.facebook.com/fixture");
        expect(state.adsPower.getProfileByNo).toHaveBeenCalledWith("456");
    });

    it("запит чекає завершення оновлення й використовує нову проксі", async () => {
        const state = await setup({ cached: snapshot() });
        let release;
        state.adsPower.getProfileByNo.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const refresh = state.service.refresh(state.accountKey);
        const request = state.transport.get("https://graph.facebook.com/fixture");
        await vi.waitFor(() => expect(state.adsPower.getProfileByNo).toHaveBeenCalledTimes(1));
        expect(state.httpClient.request).not.toHaveBeenCalled();
        release({ user_proxy_config: proxyConfig("new.example") });
        await Promise.all([refresh, request]);
        expect(state.httpClient.request.mock.calls[0][0].httpsAgent.proxy.hostname).toBe("new.example");
    });

    it("не використовує пошкоджений знімок або знімок іншого профілю", async () => {
        const state = await setup({ cached: { ...snapshot(), profileNo: "different" } });
        await state.transport.get("https://graph.facebook.com/fixture");
        expect(state.adsPower.getProfileByNo).toHaveBeenCalledWith("123");
        expect(state.httpClient.request.mock.calls[0][0].httpsAgent.proxy.hostname).toBe("profile.example");
    });

    it.each(["auto", "bound"])("режим %s зберігає свій транспорт без звернення до AdsPower", async (proxyMode) => {
        const state = await setup({ proxyMode });
        if (proxyMode === "bound") await state.accountManager.update(state.accountKey, { proxyId: "profile-123", proxyMode });
        const emptyFile = path.join(state.directory, "empty.json");
        const proxiesFile = path.join(state.directory, "proxies.json");
        await writeFile(emptyFile, JSON.stringify({ accounts: [] }));
        await writeFile(proxiesFile, JSON.stringify({ proxies: [snapshot("selected.example").proxy] }));
        const clients = await createFacebookApiClients({ accountsFilePath: state.accountsFile, bmFilePath: emptyFile,
            proxiesFilePath: proxiesFile, adsPower: state.adsPower, httpClient: state.httpClient });
        await clients.get(state.accountKey).createPageTextPost({ pageId: "fixture-page", pageAccessToken: "fixture-token", message: "Fixture" });
        expect(state.adsPower.getProfileByNo).not.toHaveBeenCalled();
        expect(state.httpClient.request.mock.calls[0][0].httpsAgent.proxy.hostname).toBe("selected.example");
    });

    it.each(["api", "bm"])("Graph API публікує пост через проксі профілю %s, навіть із доступним спільним пулом", async (kind) => {
        const state = await setup({ kind });
        const emptyFile = path.join(state.directory, "empty.json");
        const proxiesFile = path.join(state.directory, "proxies.json");
        await writeFile(emptyFile, JSON.stringify({ accounts: [] }));
        await writeFile(proxiesFile, JSON.stringify({ proxies: [snapshot("pool.example").proxy] }));
        const clients = await createFacebookApiClients({
            accountsFilePath: kind === "api" ? state.accountsFile : emptyFile,
            bmFilePath: kind === "bm" ? state.accountsFile : emptyFile,
            proxiesFilePath: proxiesFile, adsPower: state.adsPower,
            accountManagers: { [kind]: state.accountManager }, httpClient: state.httpClient,
        });
        await clients.get(state.accountKey).createPageTextPost({ pageId: "fixture-page", pageAccessToken: "fixture-page-token", message: "Fixture" });
        expect(state.httpClient.request.mock.calls[0][0].httpsAgent.proxy.hostname).toBe("profile.example");
        expect(JSON.parse(await readFile(state.accountsFile, "utf8")).accounts[0].adsPowerProxy.proxy.host).toBe("profile.example");
    });
});
