import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import AdsPower from "../classes/AdsPower.js";
import AutouploadStore from "../services/autoupload/AutouploadStore.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";
import checkProfileSession from "../workflows/autoupload/checkProfileSession.js";

const html = 'DTSGInitialData",[],{"token":"test-token"} <input name="jazoest" value="22123"> {"sessionId":"test-session","actorID":"123","client_revision":456}';
const cookies = [
    { name: "c_user", value: "123", domain: ".facebook.com", path: "/", secure: true, session: true },
    { name: "xs", value: "test-cookie", domain: ".facebook.com", path: "/", secure: true, session: true },
];
const reply = (data = html, status = 200, headers = {}) => ({ data, status, headers });
const client = (request, extra = {}) => new FacebookWebClient({ cookies, userAgent: "Test-UA", httpClient: { request }, ...extra });

async function storeFixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-autoupload-"));
    t.after(async () => {
        const target = path.resolve(directory);
        assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
        assert.ok(path.basename(target).startsWith("adsbot-autoupload-"));
        await rm(target, { recursive: true, force: true });
    });
    return new AutouploadStore(path.join(directory, "workspace.json"));
}

test("локальні групи, дедуплікація та послідовні записи", async (t) => {
    const store = await storeFixture(t);
    await Promise.all([store.group("create", null, "Перша"), store.group("create", null, "Друга")]);
    const groups = (await store.snapshot()).groups;
    assert.equal(groups.length, 3);
    const profile = { profileId: "p1", profileNo: "1", name: "Профіль" };
    await store.add([profile], groups[1].id);
    await store.add([{ ...profile, name: "Оновлений" }], groups[2].id);
    assert.equal((await store.snapshot()).profiles.length, 1);
    await store.group("delete", groups[2].id);
    assert.equal((await store.snapshot()).profiles[0].groupId, "new");
    await assert.rejects(store.group("delete", "new"));
    await assert.rejects(store.group("create", null, "Перша"));
    await store.group("create", null, "Після помилки");
    assert.equal((await store.snapshot()).profiles[0].name, "Оновлений");
});

test("пошкоджене сховище не перезаписується", async (t) => {
    const store = await storeFixture(t);
    await writeFile(store.file, "broken", "utf8");
    await assert.rejects(store.group("create", null, "Нова"));
    assert.equal(await readFile(store.file, "utf8"), "broken");
});

test("AdsPower читає cookies і UA виключно через спільний request", async () => {
    const adsPower = new AdsPower();
    const calls = [];
    adsPower.request = async (...args) => {
        calls.push(args);
        return { data: { code: 0, data: args[1].endsWith("/ua") ? [{ profile_id: "p1", ua: "Test-UA" }] : { cookies: JSON.stringify(cookies) } } };
    };
    assert.deepEqual(await adsPower.getProfileCookies("p1"), cookies);
    assert.equal(await adsPower.getProfileUserAgent("p1"), "Test-UA");
    assert.equal(calls[0][0], "get");
    assert.equal(calls[1][0], "post");
    assert.deepEqual(calls[1][2], { profile_id: ["p1"] });
    adsPower.request = async () => { throw new Error("test-secret"); };
    await assert.rejects(adsPower.getProfileCookies("p1"), (error) => !error.message.includes("test-secret"));
});

test("сесія підтверджує ID, не повертає значення токенів, враховує атрибути cookies", async () => {
    let sent;
    const web = client(async (config) => { sent = config; return reply(); }, { cookies: [...cookies,
        { name: "alien", value: "hidden", domain: ".example.com", path: "/" },
        { name: "expired", value: "hidden", domain: ".facebook.com", path: "/", expires: 1 },
        { name: "wrong_path", value: "hidden", domain: ".facebook.com", path: "/private" },
    ] });
    const result = await web.checkSession();
    assert.equal(sent.headers["User-Agent"], "Test-UA");
    assert.ok(sent.headers.Cookie.includes("c_user=123"));
    assert.ok(!sent.headers.Cookie.includes("hidden"));
    assert.ok(result.fields.includes("fb_dtsg"));
    assert.ok(!JSON.stringify(result).includes("test-token"));
    assert.equal(sent.maxRedirects, 0);
});

test("Set-Cookie застосовується до наступного переходу", async () => {
    let count = 0;
    const web = client(async (config) => {
        count += 1;
        if (count === 1) return reply("", 302, { location: "/home.php", "set-cookie": ["xs=updated; Domain=.facebook.com; Path=/; Secure"] });
        assert.ok(config.headers.Cookie.includes("xs=updated"));
        return reply();
    });
    await web.checkSession();
    assert.equal(count, 2);
});

test("cookies не надсилаються на сторонній домен", async () => {
    let count = 0;
    const web = client(async () => { count += 1; return reply("", 302, { location: "https://example.com/" }); });
    await assert.rejects(web.checkSession());
    assert.equal(count, 1);
});

test("авторизація, checkpoint і технічні помилки мають різні статуси", async () => {
    for (const [location, expected] of [["/login/", "login_required"], ["/checkpoint/", "checkpoint"]]) {
        await assert.rejects(client(async () => reply("", 302, { location })).checkSession(), (error) => error.sessionStatus === expected);
    }
    await assert.rejects(client(async () => reply("unrecognized html")).checkSession(), (error) => error.sessionStatus === "error" && error.message.includes("fb_dtsg"));
    await assert.rejects(client(async () => reply(html.replace('"123"', '"999"'))).checkSession(), (error) => error.sessionStatus === "error");
    await assert.rejects(client(async () => { throw new Error("secret-proxy-password"); }).checkSession(), (error) => !error.message.includes("secret-proxy-password"));
});

test("черга клієнта відновлюється після помилки", async () => {
    let count = 0;
    const web = client(async () => ++count === 1 ? reply("broken") : reply());
    const results = await Promise.allSettled([web.checkSession(), web.checkSession()]);
    assert.equal(results[0].status, "rejected");
    assert.equal(results[1].status, "fulfilled");
});

test("workflow не звертається до Facebook без проксі", async () => {
    let fetched = false;
    const output = await checkProfileSession({ profileId: "p1", adsPower: {
        getProfileById: async () => ({ user_proxy_config: { proxy_soft: "no_proxy" } }),
        getProfileCookies: async () => { fetched = true; },
    } });
    assert.equal(output.result.status, "error");
    assert.equal(output.result.stage, "proxy");
    assert.equal(fetched, false);
});

test("сервіс зберігає лише безпечні метадані та результат", async (t) => {
    const store = await storeFixture(t);
    const service = new AutouploadService({ store, adsPower: {
        getProfileById: async () => ({ profile_no: "12", name: "Test", password: "hidden-password", cookie: "hidden-cookie" }),
    }, checkSession: async () => ({ client: {}, result: { status: "active", message: "OK", fields: ["fb_dtsg"], steps: ["OK"] } }) });
    await service.mutate({ action: "add", ids: ["p1"] });
    await service.check(["p1"]);
    const state = await store.snapshot();
    assert.equal(state.profiles[0].status, "active");
    assert.equal(state.history.length, 1);
    assert.ok(!JSON.stringify(state).includes("hidden-"));
    await service.mutate({ action: "remove", ids: ["p1"] });
    assert.equal((await store.snapshot()).profiles.length, 0);
});

test("скасування прибирає стан перевірки й не залишає попередній успішний статус", async (t) => {
    const store = await storeFixture(t);
    await store.add([{ profileId: "p1", profileNo: "1", name: "Test" }], "new");
    await store.record("p1", { status: "active", message: "OK", fields: [], steps: [] });
    const controller = new AbortController();
    const service = new AutouploadService({ store, checkSession: async () => { controller.abort(); controller.signal.throwIfAborted(); } });
    await assert.rejects(service.check(["p1"], { signal: controller.signal }));
    const snapshot = await service.snapshot();
    assert.equal(snapshot.profiles[0].status, "error");
    assert.equal(snapshot.history[0].stage, "interrupted");
});
