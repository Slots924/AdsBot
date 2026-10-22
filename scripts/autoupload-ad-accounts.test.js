import test from "node:test";
import assert from "node:assert/strict";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import { findFriendById, getAdAccountUsers, shareAdAccount } from "../facebook/autoupload/actions/adAccounts/index.js";

const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const friend = { uid: "456", text: "Test friend", is_friend_or_self: true };
const confirmation = { confirmed: true, adAccountId: "789", targetUserId: "456", role: "ADMIN" };
const admin = { id: "456", role: 1001, permissions: [1, 2, 3, 4, 5, 7] };
const users = (values = [], extra = {}) => ({ id: "act_789", users: { data: values, ...extra } });
const friends = (entries = [friend]) => ({ payload: { entries } });
async function fixture(responses, options = {}) {
    const calls = [];
    const client = new FacebookWebClient({
        cookies: [{ name: "c_user", value: "123", domain: ".facebook.com", path: "/", secure: true }, { name: "xs", value: "fake-xs", domain: ".facebook.com", path: "/", secure: true }],
        userAgent: "Test-UA", ...options, httpClient: { async request(config, retryOptions) {
            if (config.url === "https://www.facebook.com/") return { status: 200, headers: {}, data: html };
            calls.push({ config, retryOptions });
            assert.ok(responses.length, "Неочікуваний додатковий запит");
            const next = responses.shift();
            if (next instanceof Error) throw next;
            return { status: 200, headers: {}, ...next, data: typeof next.data === "string" ? next.data : JSON.stringify(next.data) };
        } },
    });
    await client.checkSession();
    client.setAdsManagerSession({ session: { FacebookID: "123", fb_dtsg: "fake-ads-dtsg", fb_dtsg_ag: "fake-async-token" }, accessToken: "EAAB-fake-unit-test" });
    return { client, fbData: client.getFbData("test"), calls };
}

test("передача за збереженими даними робить лише один POST без читання друзів і прав РК", async () => {
    const { fbData, calls } = await fixture([{ data: { success: true } }]);
    const result = await shareAdAccount(fbData, "789", "456", { confirmation, useCachedAccess: true });
    assert.equal(result.success, true);
    assert.equal(result.writeAccepted, true);
    assert.equal(result.verified, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].config.method, "post");
});

test("пошук друга використовує UID, friends_only, поточний viewer і свіжий request_id", async () => {
    const { fbData, calls } = await fixture([{ data: friends() }, { data: friends() }]);
    assert.equal((await findFriendById(fbData, "456")).found, true);
    await findFriendById(fbData, "456");
    const urls = calls.map(call => new URL(call.config.url));
    assert.equal(urls[0].pathname, "/ajax/typeahead/first_degree.php");
    assert.equal(urls[0].searchParams.get("viewer"), "123");
    assert.equal(urls[0].searchParams.get("options[0]"), "friends_only");
    assert.equal(urls[0].searchParams.get("filter[0]"), "user");
    assert.equal(urls[0].searchParams.get("__a"), "1");
    assert.equal(urls[0].searchParams.get("__user"), "123");
    assert.equal(urls[0].searchParams.get("fb_dtsg_ag"), "fake-async-token");
    assert.notEqual(urls[0].searchParams.get("request_id"), urls[1].searchParams.get("request_id"));
    for (const key of ["q", "query", "search"]) assert.equal(urls[0].searchParams.has(key), false);
    assert.equal(calls[0].config.headers.Origin, "https://adsmanager.facebook.com");
    assert.equal(calls[0].config.headers["Sec-Fetch-Mode"], "cors");
    assert.equal(calls[0].config.headers["Sec-Fetch-User"], undefined);
});

test("без правильного підтвердження Admin-доступу жодних запитів немає", async () => {
    const { fbData, calls } = await fixture([]);
    for (const value of [undefined, { ...confirmation, targetUserId: "999" }, { ...confirmation, adAccountId: "999" }, { ...confirmation, role: "ADVERTISER" }]) {
        const result = await shareAdAccount(fbData, "789", "456", { confirmation: value });
        assert.equal(result.code, "FACEBOOK_ADMIN_CONFIRMATION_REQUIRED");
    }
    assert.equal(calls.length, 0);
});

test("відсутність друга, чужий UID або self не спричиняють POST", async () => {
    for (const entry of [[], [{ ...friend, uid: "999" }], [{ ...friend, is_friend_or_self: false }]]) {
        const { fbData, calls } = await fixture([{ data: friends(entry) }]);
        const result = await shareAdAccount(fbData, "789", "456", { confirmation });
        assert.equal(result.code, "FACEBOOK_FRIEND_NOT_FOUND");
        assert.equal(calls.length, 1);
    }
    const { fbData } = await fixture([{ data: friends([{ ...friend, uid: "123" }]) }]);
    assert.equal((await findFriendById(fbData, "123")).found, false);
});

test("Admin призначається лише через adsmanager-graph і підтверджується повторним читанням", async () => {
    const { fbData, calls } = await fixture([{ data: friends() }, { data: users() }, { data: { success: true } }, { data: users([admin]) }]);
    let intent;
    const result = await shareAdAccount(fbData, "act_789", "456", { confirmation, beforeSend: async value => { intent = value; } });
    assert.equal(result.outcome, "AD_ACCOUNT_ADMIN_GRANTED");
    assert.equal(result.verified, true);
    assert.deepEqual(intent, { adAccountId: "789", targetUserId: "456", role: "ADMIN" });
    const write = calls[2];
    assert.equal(write.config.url, "https://adsmanager-graph.facebook.com/v22.0/act_789/users");
    assert.equal(write.config.method, "post");
    assert.equal(write.config.headers.Authorization, "Bearer EAAB-fake-unit-test");
    assert.equal(calls[1].config.headers.Authorization, "Bearer EAAB-fake-unit-test");
    assert.equal(calls[0].config.headers.Authorization, undefined);
    assert.equal(write.retryOptions.retryOnConnectionError, false);
    const form = new URLSearchParams(write.config.data);
    assert.equal(form.get("uid"), "456");
    assert.equal(form.get("role"), "281423141961500");
    for (const key of ["access_token", "fb_dtsg", "jazoest", "doc_id", "_sessionID", "_callFlowletID", "xref"]) assert.equal(form.has(key), false);
    assert.ok(!JSON.stringify(result).includes("fake-xs"));
    assert.ok(!JSON.stringify(result).includes("EAAB-fake-unit-test"));
    assert.equal(calls.length, 4);
});

test("наявний Admin не призначається повторно; неповний список блокує зміну", async () => {
    const ready = await fixture([{ data: friends() }, { data: users([admin]) }]);
    assert.equal((await shareAdAccount(ready.fbData, "789", "456", { confirmation })).outcome, "AD_ACCOUNT_ALREADY_ADMIN");
    assert.equal(ready.calls.length, 2);
    const partial = await fixture([{ data: friends() }, { data: users([], { paging: { next: "not-followed" } }) }]);
    assert.equal((await shareAdAccount(partial.fbData, "789", "456", { confirmation })).code, "FACEBOOK_AD_ACCOUNT_USERS_INCOMPLETE");
    assert.equal(partial.calls.length, 2);
});

test("success:true без потрібного UID, ролі або повного набору permissions не є успіхом", async () => {
    for (const member of [{ ...admin, id: "999" }, { ...admin, role: 1002 }, { ...admin, permissions: [1, 2] }]) {
        const { fbData } = await fixture([{ data: friends() }, { data: users() }, { data: { success: true } }, { data: users([member]) }]);
        const result = await shareAdAccount(fbData, "789", "456", { confirmation });
        assert.equal(result.code, "FACEBOOK_ADMIN_VERIFICATION_FAILED");
        assert.equal(result.writeAccepted, true);
        assert.equal(result.outcomeUnknown, true);
    }
});

test("помилка API при HTTP 200 повертає реальні коди та не повторює POST", async () => {
    const { fbData, calls } = await fixture([{ data: friends() }, { data: users() }, { data: { error: { code: 200, error_subcode: 42, message: "Missing permission" } } }]);
    const result = await shareAdAccount(fbData, "789", "456", { confirmation });
    assert.equal(result.success, false);
    assert.equal(result.graphCode, 200);
    assert.equal(result.graphSubcode, 42);
    assert.equal(result.httpStatus, 200);
    assert.equal(calls.length, 3);
});

test("timeout, HTML, redirect або success:false не запускають повторний POST", async () => {
    for (const response of [new Error("timeout"), { data: "<html>unknown</html>" }, { status: 302, headers: { location: "/next" }, data: "" }, { data: { success: false } }]) {
        const { fbData, calls } = await fixture([{ data: friends() }, { data: users() }, response]);
        const result = await shareAdAccount(fbData, "789", "456", { confirmation });
        assert.equal(result.outcomeUnknown, true);
        assert.equal(result.actionRequired, "check_ad_account_permissions");
        assert.equal(calls.length, 3);
        assert.equal(result.retryable, false);
    }
});

test("збій читання після прийнятого POST залишає невизначений результат", async () => {
    const { fbData } = await fixture([{ data: friends() }, { data: users() }, { data: { success: true } }, new Error("timeout")]);
    const result = await shareAdAccount(fbData, "789", "456", { confirmation });
    assert.equal(result.success, false);
    assert.equal(result.writeAccepted, true);
    assert.equal(result.outcomeUnknown, true);
});

test("JSON-помилка авторизації інвалідує сесію і повідомляє про необхідність входу", async () => {
    let status;
    const { client, fbData } = await fixture([{ data: { error: { code: 190, message: "Session expired" } } }], { onSessionStatus: async value => { status = value.status; } });
    const result = await findFriendById(fbData, "456");
    assert.equal(result.sessionStatus, "login_required");
    assert.equal(status, "login_required");
    assert.throws(() => client.getFbData("test"));
});

test("неправильний РК, формат відповіді та скасування до POST не змінюють доступи", async () => {
    const { fbData } = await fixture([{ data: { id: "act_999", users: { data: [] } } }]);
    assert.equal((await getAdAccountUsers(fbData, "789")).code, "FACEBOOK_AD_ACCOUNT_USERS_INVALID");
    const stopped = await fixture([{ data: friends() }, { data: users() }]);
    const controller = new AbortController();
    const result = await shareAdAccount(stopped.fbData, "789", "456", { confirmation, signal: controller.signal, beforeSend: async () => controller.abort() });
    assert.equal(result.code, "TASK_INTERRUPTED");
    assert.equal(stopped.calls.length, 2);
});

test("порожня відповідь пошуку друга має окремий код, етап і розмір без POST", async () => {
    const { fbData, calls } = await fixture([{ data: "", headers: { "content-type": "text/html; charset=utf-8" } }]);
    const result = await shareAdAccount(fbData, "789", "456", { confirmation });
    assert.equal(result.code, "FACEBOOK_RESPONSE_EMPTY");
    assert.equal(result.diagnostic.status, "response_empty");
    assert.equal(result.diagnostic.stage, "friends_lookup");
    assert.equal(result.diagnostic.responseBytes, 0);
    assert.equal(result.diagnostic.contentType, "text/html");
    assert.equal(calls.length, 1);
});

test("JSON з XSSI-префіксом зберігає серверну причину 1357004 і приховує GET-токен", async () => {
    const { fbData } = await fixture([{ data: 'for (;;);{"error":1357004,"errorSummary":"Sorry","errorDescription":"Request failed fake-async-token","payload":null}' }]);
    const result = await findFriendById(fbData, "456");
    assert.equal(result.graphCode, 1357004);
    assert.equal(result.diagnostic.stage, "friends_lookup");
    assert.equal(result.diagnostic.graphCode, 1357004);
    assert.equal(result.message, "Request failed [REDACTED]");
    assert.ok(!JSON.stringify(result).includes("fake-async-token"));
});

test("Ads Manager access token не відправляється на сторонній origin", async () => {
    const { client, fbData, calls } = await fixture([]);
    assert.throws(() => client.requestAdsManagerGraph(fbData, { url: "https://example.com/" }), error => error.code === "ADS_MANAGER_GRAPH_ORIGIN_INVALID");
    assert.equal(calls.length, 0);
});
