import test from "node:test";
import assert from "node:assert/strict";
import ProxyHttpClient from "../services/proxy/ProxyHttpClient.js";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import describeHttpError from "../services/logging/httpDiagnostics.js";
import { configureRuntimeLogger } from "../services/logging/runtimeLogger.js";
import refreshProfileSession from "../workflows/autoupload/refreshProfileSession.js";

const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const token = `EAAB${"x".repeat(50)}`;
const proxy = { id: "test", type: "http", host: "private-proxy.invalid", port: "8888", username: "private-login", password: "private-pass" };
const cookies = ["c_user", "xs"].map(name => ({ name, value: name === "c_user" ? "123" : "private-xs", domain: ".facebook.com", path: "/", secure: true }));

async function refresh(request) {
    return refreshProfileSession({ profileId: "test", adsPower: {
        getProfileById: async () => ({ user_proxy_config: { proxy_type: proxy.type, proxy_host: proxy.host, proxy_port: proxy.port, proxy_user: proxy.username, proxy_password: proxy.password } }),
        getProfileCookies: async () => cookies, getProfileUserAgent: async () => "Test-UA",
    }, createClient: options => new FacebookWebClient({ ...options, httpClient: new ProxyHttpClient({ proxies: [proxy], httpClient: { request: async config => {
        if (config.url === "https://www.facebook.com/") return { status: 200, headers: {}, data: html };
        return request(config);
    } } }) }) });
}

test("timeout Ads Manager зберігає первинний код після вичерпання проксі та безпечно пишеться в лог", async () => {
    const logs = [];
    const logger = { child() { return this; }, debug() {}, info() {}, warn() {}, error(event, message, fields) { logs.push({ event, message, fields }); } };
    configureRuntimeLogger(logger);
    try {
        const { result } = await refresh(async () => { throw Object.assign(new Error(`connect ETIMEDOUT ${proxy.host} password=${proxy.password}`), { code: "ETIMEDOUT" }); });
        const warning = result.warnings[0];
        assert.equal(warning.status, "network_timeout");
        assert.equal(warning.code, "PROXY_POOL_EXHAUSTED");
        assert.equal(warning.networkCode, "ETIMEDOUT");
        assert.equal(warning.stage, "adsManager");
        assert.equal(warning.httpStatus, null);
        assert.ok(warning.message.includes("ETIMEDOUT"));
        assert.ok(logs.some(item => item.event === "autoupload.ads-manager.failed"));
        const publicData = JSON.stringify({ result, logs });
        for (const secret of [proxy.host, proxy.username, proxy.password, "private-xs", "fake-dtsg"]) assert.ok(!publicData.includes(secret));
    } finally { configureRuntimeLogger(null); }
});

test("помилка API зберігає серверний текст, HTTP, код і підкод, а інші активи продовжують завантажуватись", async () => {
    const { result } = await refresh(async config => {
        if (config.url.includes("adsmanager.facebook.com")) return { status: 200, headers: {}, data: `${html}{"accessToken":"${token}"}` };
        if (config.url.includes("/me/adaccounts")) throw Object.assign(new Error("Request failed"), { config, response: { status: 403, data: { error: {
            code: 200, error_subcode: 77, message: `Missing ads_read ${token} private-xs`,
        } } } });
        return { status: 200, headers: {}, data: { data: [] } };
    });
    const warning = result.warnings[0];
    assert.equal(warning.scope, "adAccounts");
    assert.equal(warning.status, "facebook_api_error");
    assert.equal(warning.httpStatus, 403);
    assert.equal(warning.graphCode, 200);
    assert.equal(warning.graphSubcode, 77);
    assert.ok(warning.message.startsWith("Missing ads_read"));
    assert.equal(result.assets.pagesState, "loaded");
    assert.ok(!JSON.stringify(result).includes(token));
    assert.ok(!JSON.stringify(result).includes("private-xs"));
});

test("HTTP 403, 429, 407 та Login/Checkpoint мають різні типи, без вигаданих кодів API", () => {
    for (const [httpStatus, status] of [[403, "forbidden"], [429, "rate_limited"], [407, "proxy_auth_error"], [502, "http_error"]]) {
        const detail = describeHttpError({ response: { status: httpStatus, data: { message: "Server response" } } });
        assert.equal(detail.status, status);
        assert.equal(detail.message, "Server response");
        assert.equal(detail.graphCode, null);
    }
    for (const sessionStatus of ["login_required", "checkpoint"]) assert.equal(describeHttpError({ sessionStatus }).status, sessionStatus);
    const jsonText = describeHttpError({ response: { status: 400, data: JSON.stringify({ error: { code: 100, error_subcode: 12, message: "Exact server message" } }) } });
    assert.equal(jsonText.message, "Exact server message");
    assert.equal(jsonText.graphCode, 100);
    assert.equal(jsonText.graphSubcode, 12);
});

test("адреси логуються без query та credentials, невідомі внутрішні помилки і HTML не розкриваються", () => {
    const detail = describeHttpError(Object.assign(new Error("private-internal-value"), { config: { url: "https://user:password@facebook.com/test?secret=hidden" }, response: { status: 500, data: "<html>private-html</html>", headers: { "content-type": "text/html" } } }));
    assert.equal(detail.endpoint, "https://facebook.com/test");
    assert.equal(detail.message, "Не вдалося виконати HTTP-запит");
    assert.ok(!JSON.stringify(detail).includes("private-"));
});

test("POST після розриву з’єднання не повторюється, але повертає точний первинний код", async () => {
    let count = 0;
    const client = new ProxyHttpClient({ proxies: [proxy], httpClient: { request: async () => { count++; throw Object.assign(new Error(`reset ${proxy.host}`), { code: "ECONNRESET" }); } } });
    await assert.rejects(() => client.request({ method: "post", url: "https://facebook.com/test" }, { retryOnConnectionError: false }), error => {
        assert.equal(error.code, "PROXY_REQUEST_OUTCOME_UNKNOWN");
        assert.equal(error.diagnostic.networkCode, "ECONNRESET");
        assert.equal(error.diagnostic.status, "network_error");
        assert.ok(!error.diagnostic.message.includes(proxy.host));
        return true;
    });
    assert.equal(count, 1);
});
