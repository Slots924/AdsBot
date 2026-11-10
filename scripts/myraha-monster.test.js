import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import MyrahaMonster, { defaultMyrahaMonsterUrl } from "../classes/MyrahaMonster.js";

const item = (id, enabled = false) => ({ id, enabled, integrationReady: true, geo: "US", language: "en", creative: "202" });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

async function fixture(t, httpRequest) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-myraha-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const settingsFile = path.join(directory, "settings.json");
    const client = new MyrahaMonster({ settingsFile, httpRequest,
        encrypt: (value) => Buffer.from(value).toString("base64"), decrypt: (value) => Buffer.from(value, "base64").toString() });
    await client.saveSettings({ apiKey: "test-only-key" });
    return { client, settingsFile };
}

test("налаштування приховують ключ, підтримують заміну, збереження та видалення", async (t) => {
    const { client, settingsFile } = await fixture(t);
    const settings = await client.getSettings();
    assert.equal(settings.baseUrl, defaultMyrahaMonsterUrl);
    assert.equal(settings.hasApiKey, true);
    assert.equal(Object.hasOwn(settings, "apiKey"), false);
    assert.equal((await readFile(settingsFile, "utf8")).includes("test-only-key"), false);
    await client.saveSettings({ baseUrl: "https://example.com/api/v1/", apiKey: "" });
    assert.equal((await client.getSettings()).hasApiKey, true);
    await client.saveSettings({ apiKey: "replacement" });
    assert.equal(JSON.parse(await readFile(settingsFile, "utf8")).apiKey, Buffer.from("replacement").toString("base64"));
    await client.saveSettings({ removeApiKey: true });
    assert.equal((await client.getSettings()).hasApiKey, false);
    await assert.rejects(client.getPages(), { code: "MYRAHA_NO_KEY" });
    await assert.rejects(client.saveSettings({ baseUrl: "http://example.com" }), { code: "MYRAHA_CONFIG" });
});

test("пагінація та Bearer; метадані сервера не потрапляють у стан GUI", async (t) => {
    const calls = [];
    const { client } = await fixture(t, async (options) => {
        calls.push(options);
        return { status: 200, data: { items: [item(String(options.params.page))], page: options.params.page, pageSize: 1, total: 2 } };
    });
    assert.deepEqual((await client.getPages()).items, [
        { id: "1", enabled: false, integrationReady: true }, { id: "2", enabled: false, integrationReady: true },
    ]);
    assert.deepEqual(calls.map((call) => call.params.page), [1, 2]);
    assert.equal(calls[0].headers.Authorization, "Bearer test-only-key");
    assert.equal(calls[0].timeout, 30000);
    assert.equal(calls[0].maxRedirects, 0);
});

test("PATCH передає виключно enabled і зберігає довгий рядковий ID", async (t) => {
    const calls = [];
    const id = "12345678901234567890";
    const serverPage = item(id);
    const { client } = await fixture(t, async (options) => {
        calls.push(options);
        Object.assign(serverPage, options.data);
        return { status: 200, data: { id, enabled: serverPage.enabled } };
    });
    assert.equal((await client.setModeration(id, true)).enabled, true);
    assert.deepEqual(calls[0].data, { enabled: true });
    assert.equal(calls[0].url, `${defaultMyrahaMonsterUrl}/pages/${id}/moderation`);
    assert.deepEqual(serverPage, item(id, true));
    await assert.rejects(client.setModeration(123, true), { code: "MYRAHA_INPUT" });
    await assert.rejects(client.setModeration("1", "true"), { code: "MYRAHA_INPUT" });
});

test("запити різних фанок починаються паралельно", async (t) => {
    const first = deferred();
    const secondStarted = deferred();
    const { client } = await fixture(t, async (options) => {
        if (options.url.includes("/1/")) await first.promise;
        else secondStarted.resolve();
        return { status: 200, data: { id: options.url.includes("/1/") ? "1" : "2", enabled: true } };
    });
    const a = client.setModeration("1", true);
    const b = client.setModeration("2", true);
    await secondStarted.promise;
    first.resolve();
    await Promise.all([a, b]);
});

test("після втрати відповіді PATCH стан перевіряється без повтору mutation", async (t) => {
    const methods = [];
    const { client } = await fixture(t, async (options) => {
        methods.push(options.method);
        if (options.method === "patch") throw new Error("Секретна діагностика транспорту");
        return { status: 200, data: item("1", true) };
    });
    const result = await client.setModeration("1", true);
    assert.equal(result.enabled, true);
    assert.equal(result.reconciled, true);
    assert.deepEqual(methods, ["patch", "get"]);
});

test("невідомий результат не розкриває помилки HTTP-клієнта", async (t) => {
    const { client } = await fixture(t, async () => { throw new Error("test-only-key"); });
    await assert.rejects(client.setModeration("1", true), (error) =>
        error.code === "MYRAHA_UNKNOWN" && error.outcomeUnknown && !error.message.includes("test-only-key") && !error.cause);
});

for (const status of [400, 401, 403, 404, 429, 503]) {
    test(`HTTP ${status} повертається без повторів і секретного тіла`, async (t) => {
        let calls = 0;
        const { client } = await fixture(t, async () => { calls++; return { status, data: { error: "test-only-key" } }; });
        await assert.rejects(client.setModeration("1", true), (error) => error.httpStatus === status && !error.message.includes("test-only-key"));
        assert.equal(calls, 1);
    });
}

test("відповідь запиту зі старими налаштуваннями відхиляється", async (t) => {
    const started = deferred();
    const finish = deferred();
    const { client } = await fixture(t, async () => {
        started.resolve(); await finish.promise;
        return { status: 200, data: item("1") };
    });
    const operation = client.getPage("1");
    const rejected = assert.rejects(operation, { code: "MYRAHA_STALE" });
    await started.promise;
    await client.saveSettings({ apiKey: "new-test-key" });
    finish.resolve();
    await rejected;
});

test("неповний список не стає успішним результатом", async (t) => {
    const { client } = await fixture(t, async () => ({ status: 200, data: { page: 1, pageSize: 50, total: 100, items: [] } }));
    await assert.rejects(client.getPages(), { code: "MYRAHA_RESPONSE" });
});
