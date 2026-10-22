import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import AutouploadSessionStore from "../services/autoupload/AutouploadSessionStore.js";
import AutouploadStore from "../services/autoupload/AutouploadStore.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import refreshProfileSession from "../workflows/autoupload/refreshProfileSession.js";
import { extractFacebookAccessTokenFromHtml } from "../facebook/api/browserCredentials.js";

const fakeToken = `EAAB${"x".repeat(50)}`;
const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const cookies = ["c_user", "xs"].map((name) => ({ name, value: name === "c_user" ? "123" : "fake-xs", domain: ".facebook.com", path: "/", session: true, secure: true }));
const proxy = { id: "test", type: "http", host: "127.0.0.1", port: "1234" };
async function fixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-sessions-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("adsbot-sessions-"));
        await rm(directory, { recursive: true, force: true });
    });
    const key = randomBytes(32);
    const sessionStore = new AutouploadSessionStore({ directory: path.join(directory, "sessions"),
        encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64"); },
        decrypt(value) { const body = Buffer.from(value, "base64"); const decipher = createDecipheriv("aes-256-gcm", key, body.subarray(0, 12)); decipher.setAuthTag(body.subarray(12, 28)); return Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString("utf8"); },
    });
    return { directory, sessionStore, store: new AutouploadStore(path.join(directory, "workspace.json")) };
}
async function prepared(options = {}) {
    const client = new FacebookWebClient({ cookies, userAgent: "Test-UA", proxy, httpClient: { request: async () => ({ status: 200, headers: {}, data: html }) }, ...options });
    await client.checkSession();
    client.setAdsManagerSession({ session: { FacebookID: "123", fb_dtsg: "fake-ads-token" }, accessToken: fakeToken });
    return client;
}

test("сесії Facebook і Ads Manager та токен зберігаються зашифрованими й відновлюються", async (t) => {
    const { sessionStore } = await fixture(t);
    const client = await prepared();
    await sessionStore.save("p1", client.exportSession());
    const files = await readdir(sessionStore.directory);
    const disk = await readFile(path.join(sessionStore.directory, files[0]), "utf8");
    for (const secret of [fakeToken, "fake-xs", "fake-dtsg", "fake-ads-token"]) assert.ok(!disk.includes(secret));
    const restored = FacebookWebClient.restore(await sessionStore.load("p1"));
    assert.equal(restored.getFbData("p1").userId, "123");
    assert.equal(restored.exportSession().adsManager.accessToken, fakeToken);
    await sessionStore.remove("p1");
    assert.equal(await sessionStore.load("p1"), null);
});

test("застарілий знімок не використовується для дій", async () => {
    const client = await prepared();
    const snapshot = client.exportSession();
    snapshot.checkedAt = new Date(Date.now() - 16 * 60_000).toISOString();
    const restored = FacebookWebClient.restore(snapshot);
    assert.throws(() => restored.validateFbData(restored.getFbData("p1")), (error) => error.code === "FACEBOOK_SESSION_EXPIRED");
});

test("дія після нового запуску використовує диск, не звертаючись до AdsPower повторно", async (t) => {
    const { store, sessionStore } = await fixture(t);
    await store.add([{ profileId: "p1", profileNo: "1", name: "Test" }], "new");
    await sessionStore.save("p1", (await prepared()).exportSession());
    const service = new AutouploadService({ store, sessionStore,
        checkSession: async () => { throw new Error("Must not refresh"); },
        sendFriendRequestFn: async (_fbData, targetUserId, options) => { await options.beforeSend(); return { success: true, outcome: "FRIEND_REQUEST_SENT", message: "OK", targetUserId }; },
    });
    const result = await service.sendFriendRequests(["p1"], "456");
    assert.equal(result.result.profiles[0].success, true);
    const publicState = JSON.stringify(await service.snapshot());
    for (const secret of [fakeToken, "fake-xs", "fake-dtsg"]) assert.ok(!publicState.includes(secret));
});

test("помилка авторизації змінює індикатор і видаляє непридатні секрети з диска", async (t) => {
    const { store, sessionStore } = await fixture(t);
    await store.add([{ profileId: "p1", profileNo: "1", name: "Test" }], "new");
    await sessionStore.save("p1", (await prepared()).exportSession());
    const service = new AutouploadService({ store, sessionStore, sendFriendRequestFn: async () => ({ success: false, message: "Login required", sessionStatus: "login_required", code: "FACEBOOK_GRAPHQL_ERROR" }) });
    await service.sendFriendRequests(["p1"], "456");
    assert.equal((await service.snapshot()).profiles[0].status, "login_required");
    assert.equal(await sessionStore.load("p1"), null);
});

test("повна перевірка читає РК і сторінки, а секрети сторінок не повертає в GUI", async () => {
    const output = await refreshProfileSession({ profileId: "p1", adsPower: {
        getProfileById: async () => ({ user_proxy_config: { proxy_type: "http", proxy_host: "127.0.0.1", proxy_port: "1234" } }),
        getProfileCookies: async () => cookies, getProfileUserAgent: async () => "Test-UA",
    }, createClient: (options) => new FacebookWebClient({ ...options, httpClient: { request: async (config) => {
        if (config.url.includes("/me/adaccounts")) return { status: 200, headers: {}, data: { data: [{ id: "act_1", account_id: "1", name: "Test account", account_status: 1 }] } };
        if (config.url.includes("/me/accounts")) return { status: 200, headers: {}, data: { data: [{ id: "2", name: "Test page", access_token: "fake-page-secret" }] } };
        return { status: 200, headers: {}, data: config.url.includes("adsmanager.") ? `${html}<script>{"accessToken":"${fakeToken}"}</script>` : html };
    } } }) });
    assert.equal(output.result.assets.adAccounts[0].accountStatus, 1);
    assert.equal(output.result.assets.pages[0].name, "Test page");
    assert.equal(output.result.capabilities.accessToken, true);
    assert.ok(!JSON.stringify(output.result).includes(fakeToken));
    assert.ok(!JSON.stringify(output.result).includes("fake-page-secret"));
});

test("EAAB-екстрактор пропускає інші EAA-токени, зберігаючи старий контракт", () => {
    const other = `EAAZ${"y".repeat(50)}`;
    const source = `{"accessToken":"${other}"} {"accessToken":"${fakeToken}"}`;
    assert.equal(extractFacebookAccessTokenFromHtml(source), other);
    assert.equal(extractFacebookAccessTokenFromHtml(source, { prefix: "EAAB" }), fakeToken);
});

async function shareFixture(t) {
    const setup = await fixture(t);
    await setup.store.add([{ profileId: "p1", profileNo: "1", name: "Test" }, { profileId: "p2", profileNo: "2", name: "Other" }], "new");
    for (const profileId of ["p1", "p2"]) {
        await setup.sessionStore.save(profileId, (await prepared()).exportSession());
        await setup.store.record(profileId, { status: "active", message: "OK", assets: { adAccounts: [
            { accountId: profileId === "p1" ? "111" : "222", isPersonal: true }, { accountId: "333", isPersonal: false, businessId: "9" }, { accountId: "444" },
        ] } });
    }
    return setup;
}

test("шеринг перевіряє підтвердження, вибрані профілі та належність РК до персональних", async (t) => {
    const setup = await shareFixture(t);
    const service = new AutouploadService(setup);
    const input = { ids: ["p1"], accounts: [{ profileId: "p1", adAccountId: "111" }], targetUserId: "456", confirmed: true };
    for (const invalid of [
        { ...input, confirmed: false }, { ...input, accounts: [] }, { ...input, accounts: [{ profileId: "p2", adAccountId: "222" }] },
        { ...input, accounts: [{ profileId: "p1", adAccountId: "333" }] }, { ...input, accounts: [{ profileId: "p1", adAccountId: "444" }] },
    ]) await assert.rejects(() => service.validateShareSelection(invalid));
    assert.equal((await service.validateShareSelection(input)).accounts.length, 1);
});

test("РК шеряться послідовно зі збережених сесій, результати не потрапляють у журнал заявок", async (t) => {
    const setup = await shareFixture(t);
    const order = [];
    let active = 0;
    const service = new AutouploadService({ ...setup, checkSession: async () => { throw new Error("No refresh"); },
        shareAdAccountFn: async (_fbData, adAccountId, targetUserId, options) => {
            assert.equal(++active, 1);
            await options.beforeSend();
            await new Promise(resolve => setImmediate(resolve));
            order.push(adAccountId); active--;
            return { success: adAccountId === "222", message: "Result", outcomeUnknown: false, adAccountId, targetUserId };
        },
    });
    const result = await service.shareAdAccounts({ ids: ["p1", "p2"], accounts: [{ profileId: "p1", adAccountId: "111" }, { profileId: "p2", adAccountId: "222" }], targetUserId: "456", confirmed: true });
    assert.deepEqual(order, ["111", "222"]);
    assert.equal(result.taskStatus, "completed_with_warnings");
    const state = await setup.store.snapshot();
    assert.equal(state.history.filter(item => item.operation === "ad-account-share").length, 2);
    assert.equal(state.friendRequests, undefined);
    assert.equal(state.adAccountShares["p2:222:456"].success, true);
});

test("незавершена зміна доступів після перезапуску блокує новий POST і зберігає невизначеність", async (t) => {
    const setup = await shareFixture(t);
    await setup.store.beginAdAccountShare("p1", "111", "456");
    let writes = 0;
    const service = new AutouploadService({ ...setup, shareAdAccountFn: async (_data, _id, _target, options) => { await options.beforeSend(); writes++; return { success: true }; } });
    const result = await service.shareAdAccounts({ ids: ["p1"], accounts: [{ profileId: "p1", adAccountId: "111" }], targetUserId: "456", confirmed: true });
    assert.equal(writes, 0);
    assert.equal(result.result.accounts[0].outcomeUnknown, true);
    assert.equal((await setup.store.snapshot()).adAccountShares["p1:111:456"].outcomeUnknown, true);
});

test("втрата авторизації під час шерингу змінює індикатор і не використовує сесію для наступного РК", async (t) => {
    const setup = await shareFixture(t);
    await setup.store.record("p1", { status: "active", message: "OK", assets: { adAccounts: [{ accountId: "111", isPersonal: true }, { accountId: "112", isPersonal: true }] } });
    let calls = 0;
    const service = new AutouploadService({ ...setup, shareAdAccountFn: async () => {
        calls++;
        return { success: false, code: "FACEBOOK_SESSION_ERROR", sessionStatus: "login_required", message: "Потрібна авторизація" };
    } });
    const result = await service.shareAdAccounts({ ids: ["p1"], accounts: [{ profileId: "p1", adAccountId: "111" }, { profileId: "p1", adAccountId: "112" }], targetUserId: "456", confirmed: true });
    assert.equal(calls, 1);
    assert.equal(result.result.accounts[1].sessionStatus, "login_required");
    assert.equal((await setup.store.snapshot()).profiles[0].status, "login_required");
    assert.equal(await setup.sessionStore.load("p1"), null);
});
