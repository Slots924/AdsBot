import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import refreshFacebookAccessToken from "../services/accounts/refreshFacebookAccessToken.js";

const token = `EAAB${"x".repeat(40)}`;
const html = 'DTSGInitialData",[],{"token":"test-dtsg"} <input name="jazoest" value="2123"> {"sessionId":"test-session","actorID":"123","client_revision":456}';

async function fixture(run) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-token-test-"));
    const calls = [], updates = [];
    const options = { accountKey: "account-001", directory,
        accountManager: {
            getHttpCredentials: async () => ({ cookie: "c_user=123; xs=test-xs", userAgent: "Test-UA" }),
            update: async (key, patch) => updates.push({ key, patch }),
        },
        httpClient: { request: async (config) => {
            calls.push(config);
            return { status: 200, headers: {}, data: `${html} {"accessToken":"${token}"}` };
        } },
    };
    try { await run({ options, calls, updates, directory }); }
    finally { await rm(directory, { recursive: true, force: true }); }
}

test("оновлення токена робить один GET Ads Manager через переданий транспорт і приховує секрети", () => fixture(async ({ options, calls, updates, directory }) => {
    const result = await refreshFacebookAccessToken(options);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://adsmanager.facebook.com/adsmanager/manage/campaigns");
    assert.match(calls[0].headers.Cookie, /c_user=123/);
    assert.equal(calls[0].headers["User-Agent"], "Test-UA");
    assert.deepEqual(updates, [{ key: "account-001", patch: { accessToken: token } }]);
    assert.equal(result.accessTokenUpdated, true);
    const history = await readFile(path.join(directory, (await readdir(directory))[0]), "utf8");
    for (const secret of [token, "test-xs", "test-dtsg", "test-session"]) {
        assert.equal(history.includes(secret), false);
        assert.equal(JSON.stringify(result).includes(secret), false);
    }
}));

for (const [name, response] of [
    ["відсутній токен", { status: 200, headers: {}, data: html }],
    ["інший акаунт", { status: 200, headers: {}, data: `${html.replace('"123"', '"999"')} ${token}` }],
    ["невалідний HTML", { status: 200, headers: {}, data: "invalid" }],
    ["потрібен вхід", { status: 302, headers: { location: "https://www.facebook.com/login/" }, data: "" }],
]) test(`старий токен зберігається: ${name}`, () => fixture(async ({ options, updates }) => {
    options.httpClient.request = async () => response;
    await assert.rejects(refreshFacebookAccessToken(options));
    assert.equal(updates.length, 0);
}));

test("timeout і скасування не зберігають токен", () => fixture(async ({ options, updates }) => {
    options.httpClient.request = async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); };
    await assert.rejects(refreshFacebookAccessToken(options));
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(refreshFacebookAccessToken({ ...options, signal: controller.signal }));
    assert.equal(updates.length, 0);
}));
