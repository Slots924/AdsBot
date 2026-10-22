import test from "node:test";
import assert from "node:assert/strict";
import analyze, { safeDiagnosticUrl } from "../services/autoupload/diagnostics/analyzeAdsManagerHtml.js";
import createFacebookCookieJar from "../facebook/session/createFacebookCookieJar.js";

const fakeToken = `EAAB${"x".repeat(60)}`;
test("аналіз виявляє ознаки токена у bootstrap, не повертаючи його значення", () => {
    const html = `<script type="application/json">${JSON.stringify({ require: [["AdsPEGlobal", [], { accessToken: fakeToken }]] })}</script>`;
    const result = analyze(html, { url: "https://adsmanager.facebook.com/" });
    assert.equal(result.eaab, "FOUND");
    assert.deepEqual(result.tokenCategories, ["bootstrap_json"]);
    assert.ok(result.tokenContainers[0].includes("AdsPEGlobal"));
    assert.ok(result.tokenContextModules.includes("AdsPEGlobal"));
    assert.ok(!JSON.stringify(result).includes(fakeToken));
});
test("Business loginpage не є авторизованим Business UI навіть із поточним actorID", () => {
    const result = analyze('{"actorID":"123"}', { url: "https://business.facebook.com/business/loginpage/", expectedUserId: "123" });
    assert.equal(result.actorMatches, true);
    assert.equal(result.login, true);
});
test("URL не містять query, credentials, токенів або вмісту data URI", () => {
    assert.equal(safeDiagnosticUrl(`https://user:pass@adsmanager.facebook.com/manage/123?access_token=${fakeToken}`), "https://adsmanager.facebook.com/manage/[id]");
    assert.equal(safeDiagnosticUrl(`data:application/json;base64,${Buffer.from(fakeToken).toString("base64")}`), "[non-http]");
    const result = analyze(`<script src="data:application/json;base64,${Buffer.from(fakeToken).toString("base64")}"></script>`, { url: "https://www.facebook.com/" });
    assert.equal(result.scriptSourceCount, 0);
});
test("спільний cookie jar враховує HostOnly, домен, шлях, Secure і строк дії", () => {
    const jar = createFacebookCookieJar([
        { name: "shared", value: "test", domain: ".facebook.com", path: "/", secure: true, session: true },
        { name: "host", value: "test", domain: "www.facebook.com", path: "/", secure: true, session: true },
        { name: "path", value: "test", domain: ".facebook.com", path: "/private", session: true },
        { name: "expired", value: "test", domain: ".facebook.com", path: "/", expires: 1 },
    ]);
    const cookies = jar.getCookieStringSync("https://adsmanager.facebook.com/");
    assert.equal(cookies, "shared=test");
    assert.equal(jar.getCookieStringSync("http://adsmanager.facebook.com/"), "");
    assert.equal(jar.getCookieStringSync("https://example.com/"), "");
});
