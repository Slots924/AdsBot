import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import SpendServerService, { cookieItems, installationIdFor } from "../services/gui/SpendServerService.js";

async function fixture(t, request) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-spend-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const credentials = { afpToken: "mock-token", cookie: "c_user=123; xs=mock-session" };
    const accountManager = {
        list: async () => [{ accountKey: "account-053", hasCookie: true }],
        getEditorCredentials: async () => ({ ...credentials }),
    };
    const options = { file: path.join(directory, "settings.json"), accountManager, request };
    const service = new SpendServerService(options);
    return { service, credentials, options };
}

test("Стабільний UUID для кожного ID клієнта", () => {
    assert.match(installationIdFor("account-053"), /^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-8[\da-f]{3}-[\da-f]{12}$/);
    assert.equal(installationIdFor("account-053"), installationIdFor("account-053"));
    assert.notEqual(installationIdFor("account-053"), installationIdFor("account-054"));
});

test("Cookies потребують повної сесії та зберігають знаки рівності", () => {
    assert.throws(() => cookieItems("c_user=123"));
    assert.equal(cookieItems("c_user=123; xs=value=123")[1].value, "value=123");
});

test("Підстановка 053, Windows UA, валідне тіло, повторні відправки та збереження статусу", async (t) => {
    const requests = [];
    const { service, credentials, options } = await fixture(t, async (...args) => { requests.push(args); return { status: 200 }; });
    const defaults = await service.getSettings();
    assert.equal(defaults.cookies, credentials.cookie);
    assert.match(defaults.userAgent, /Windows NT/);
    await service.saveSettings({ ...defaults, url: "https://spend.example.com", clientKey: "mock-key" });
    assert.equal((await service.send("account-001")).state, "success");
    await service.send("account-001");
    assert.equal(requests.length, 2);
    const [url, body, config] = requests[0];
    assert.equal(url, "https://spend.example.com/fb_data/add");
    assert.equal(config.headers["X-Client-Key"], "mock-key");
    assert.equal(config.maxRedirects, 0);
    assert.equal(body.token.value, credentials.afpToken);
    assert.equal(body.schemaVersion, 3);
    assert.equal(body.enabled, true);
    assert.equal(body.cookies.items.length, 2);
    assert.equal(body.installationId, requests[1][1].installationId);
    assert.equal(new Date(body.sentAt).toISOString(), body.sentAt);
    assert.equal((await new SpendServerService(options).status("account-001")).state, "success");
    credentials.afpToken = "changed-token";
    assert.equal((await service.status("account-001")).state, "pending");
    await service.send("account-001", "old-token");
    assert.equal(requests.length, 2);
});

test("Помилки сервера не розкривають секрети та скидають зелений статус", async (t) => {
    let failed = false;
    const { service } = await fixture(t, async () => {
        if (failed) throw Object.assign(new Error("mock-secret-cookie"), { isAxiosError: true, response: { status: 401 } });
        return { status: 204 };
    });
    const defaults = await service.getSettings();
    await service.saveSettings({ ...defaults, url: "https://spend.example.com" });
    assert.equal((await service.send("account-001")).state, "success");
    failed = true;
    const result = await service.send("account-001");
    assert.equal(result.state, "error");
    assert.match(result.message, /401/);
    assert.equal(JSON.stringify(result).includes("mock-secret"), false);
});

test("Налаштування перевіряються, їх зміна скидає статус; без адреси немає запиту", async (t) => {
    let calls = 0;
    const { service } = await fixture(t, async () => { calls++; return { status: 200 }; });
    const defaults = await service.getSettings();
    assert.equal((await service.send("account-001")).state, "error");
    assert.equal(calls, 0);
    for (const url of ["http://spend.example.com", "https://user:pass@spend.example.com", "https://spend.example.com/other"]) {
        await assert.rejects(service.saveSettings({ ...defaults, url }));
    }
    await assert.rejects(service.saveSettings({ ...defaults, userAgent: "invalid\nUA" }));
    await assert.rejects(service.saveSettings({ ...defaults, cookies: "c_user=123" }));
    const settings = await service.saveSettings({ ...defaults, url: "https://spend.example.com" });
    await service.send("account-001");
    await service.saveSettings({ ...settings, clientKey: "new-key" });
    assert.equal((await service.status("account-001")).state, "pending");
});

test("Відповідь старого запиту не відновлює статус після зміни токена", async (t) => {
    let complete;
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    const { service, credentials } = await fixture(t, async () => {
        started();
        return new Promise((resolve) => { complete = resolve; });
    });
    const defaults = await service.getSettings();
    await service.saveSettings({ ...defaults, url: "https://spend.example.com" });
    const sending = service.send("account-001");
    await ready;
    credentials.afpToken = "changed-token";
    await service.invalidate("account-001");
    complete({ status: 200 });
    assert.equal((await sending).state, "pending");
    credentials.afpToken = "mock-token";
    assert.equal((await service.status("account-001")).state, "pending");
});
