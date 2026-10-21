import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import sendFriendRequest from "../facebook/autoupload/actions/friends/sendFriendRequest.js";
import parseWebSession from "../facebook/session/parseWebSession.js";
import AutouploadStore from "../services/autoupload/AutouploadStore.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";

const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const cookies = ["c_user", "xs"].map((name) => ({ name, value: name === "c_user" ? "123" : "fake-xs", domain: ".facebook.com", path: "/", session: true, secure: true }));
const recipient = (id = "456", status = "OUTGOING_REQUEST") => ({ data: { friend_request_send: { friend_requestees: [{ id, friendship_status: status }] } } });
const response = (body, status = 200) => ({ status, headers: {}, data: typeof body === "string" ? body : JSON.stringify(body) });
async function ready(send, home = html) {
    const calls = [];
    const client = new FacebookWebClient({ cookies, userAgent: "Test-UA", httpClient: {
        request: async (config, options) => {
            if (config.method === "get") return response(home);
            calls.push({ config, options });
            return send(config, options);
        },
    } });
    await client.checkSession();
    return { client, calls, fbData: client.getFbData("test") };
}
async function storeFixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-friends-"));
    t.after(async () => {
        const target = path.resolve(directory);
        assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
        assert.ok(path.basename(target).startsWith("adsbot-friends-"));
        await rm(target, { recursive: true, force: true });
    });
    return new AutouploadStore(path.join(directory, "workspace.json"));
}

test("заявка використовує fbData, form-urlencoded та підтвердження потрібного отримувача", async () => {
    const { fbData, calls } = await ready(() => response(`for (;;);\n${JSON.stringify(recipient())}\n${JSON.stringify({ is_final: true })}`));
    const result = await sendFriendRequest(fbData, "456");
    assert.equal(result.success, true);
    assert.equal(result.outcome, "FRIEND_REQUEST_SENT");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.retryOnConnectionError, false);
    assert.equal(calls[0].config.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(calls[0].config.headers["X-FB-LSD"], "fake-lsd");
    assert.equal(calls[0].config.headers["Sec-Fetch-Mode"], "cors");
    const form = new URLSearchParams(calls[0].config.data);
    const variables = JSON.parse(form.get("variables"));
    assert.deepEqual(variables.input.friend_requestee_ids, ["456"]);
    assert.equal(variables.input.actor_id, "123");
    assert.equal(variables.input.click_proof_validation_result, undefined);
    assert.ok(!JSON.stringify(result).includes("fake-dtsg"));
    assert.ok(!JSON.stringify(result).includes("fake-xs"));
});

test("HTTP 200, інший отримувач або is_final без OUTGOING_REQUEST не є успіхом", async () => {
    for (const payload of [{ is_final: true }, recipient("999"), recipient("456", "ARE_FRIENDS")]) {
        const { fbData } = await ready(() => response(payload));
        const result = await sendFriendRequest(fbData, "456");
        assert.equal(result.success, false);
        assert.equal(result.outcomeUnknown, true);
        assert.equal(result.actionRequired, "check_friendship_status");
    }
});

test("GraphQL-помилка містить фактичні коди, підкод та безпечний текст", async () => {
    const { fbData } = await ready(() => response({ errors: [{ message: "Rejected fake-dtsg fake-lsd xs=fake-xs", code: 1234, api_error_code: 5678, error_subcode: 90 }] }, 400));
    const result = await sendFriendRequest(fbData, "456");
    assert.equal(result.code, "FACEBOOK_GRAPHQL_ERROR");
    assert.equal(result.httpStatus, 400);
    assert.equal(result.graphCode, 1234);
    assert.equal(result.apiErrorCode, 5678);
    assert.equal(result.graphSubcode, 90);
    assert.equal(result.retryable, false);
    assert.ok(!JSON.stringify(result).includes("fake-"));
});

test("помилки data.errors та помилки часткової відповіді не маскуються успішним фрагментом", async () => {
    for (const payload of [{ data: { errors: [{ message: "Nested", code: 12 }] } }, { ...recipient(), errors: [{ message: "Partial", code: 13 }] }]) {
        const { fbData } = await ready(() => response(payload));
        const result = await sendFriendRequest(fbData, "456");
        assert.equal(result.success, false);
        assert.equal(result.code, "FACEBOOK_GRAPHQL_ERROR");
    }
});

test("прострочена авторизація повертає потрібну дію та стан сесії", async () => {
    const { fbData } = await ready(() => response({ errors: [{ message: "Login required", code: 190 }] }));
    const result = await sendFriendRequest(fbData, "456");
    assert.equal(result.sessionStatus, "login_required");
    assert.equal(result.actionRequired, "authenticate_account");
});

test("timeout, HTML та redirect після POST не спричиняють повторний запит", async () => {
    for (const send of [
        () => { throw new Error("fake-network-secret"); },
        () => response("<html>Unexpected</html>"),
        () => ({ ...response("", 307), headers: { location: "/api/graphql/" } }),
        () => ({ ...response("", 302), headers: { location: "/login/" } }),
    ]) {
        const { fbData, calls } = await ready(send);
        const result = await sendFriendRequest(fbData, "456");
        assert.equal(result.success, false);
        assert.equal(result.outcomeUnknown, true);
        assert.equal(result.retryable, false);
        assert.equal(calls.length, 1);
        assert.ok(!JSON.stringify(result).includes("fake-network-secret"));
    }
});

test("некоректний ID, заявка собі та відсутній LSD не виконують POST", async () => {
    const { fbData, calls } = await ready(() => response(recipient()));
    for (const target of ["invalid", "123"]) assert.equal((await sendFriendRequest(fbData, target)).success, false);
    assert.equal(calls.length, 0);
    const withoutLsd = await ready(() => response(recipient()), html.replace('LSD",[],{"token":"fake-lsd"}', ""));
    assert.equal((await sendFriendRequest(withoutLsd.fbData, "456")).code, "FACEBOOK_SESSION_FIELDS_MISSING");
    assert.equal(withoutLsd.calls.length, 0);
});

test("застарілий fbData після оновлення сесії відхиляється до POST", async () => {
    const { client, fbData, calls } = await ready(() => response(recipient()));
    await client.checkSession();
    assert.equal((await sendFriendRequest(fbData, "456")).code, "FACEBOOK_SESSION_MISMATCH");
    assert.equal(calls.length, 0);
    assert.equal(parseWebSession(html).session.lsd, "fake-lsd");
});

test("обрані профілі виконуються послідовно, помилка одного не зупиняє наступний", async (t) => {
    const store = await storeFixture(t);
    await store.add([1, 2, 3].map((id) => ({ profileId: `p${id}`, profileNo: String(id), name: "Test" })), "new");
    const order = [];
    let active = 0;
    const service = new AutouploadService({ store, checkSession: async ({ profileId }) => ({
        client: { getFbData: () => ({ profileId }) }, result: { status: "active", message: "OK", fields: [], steps: ["OK"] },
    }), sendFriendRequestFn: async (fbData, targetUserId, options) => {
        assert.equal(active++, 0);
        await options.beforeSend();
        order.push(fbData.profileId);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return { success: fbData.profileId !== "p2", message: "Test result", outcome: fbData.profileId === "p2" ? "NOT_CONFIRMED" : "FRIEND_REQUEST_SENT", targetUserId, outcomeUnknown: false, retryable: false };
    } });
    const result = await service.sendFriendRequests(["p3", "p2", "p1"], "456");
    assert.deepEqual(order, ["p3", "p2", "p1"]);
    assert.equal(result.result.profiles.length, 3);
    assert.equal(result.taskStatus, "completed_with_warnings");
    assert.ok((await service.snapshot()).profiles.every((profile) => profile.status === "active"));
});

test("попередній успіх не надсилає заявку вдруге, навіть після нового запуску задачі", async (t) => {
    const store = await storeFixture(t);
    await store.add([{ profileId: "p1", profileNo: "1", name: "Test" }], "new");
    let posts = 0;
    const service = new AutouploadService({ store, checkSession: async () => {
        const { client } = await ready(() => { posts += 1; return response(recipient()); });
        return { client, result: { status: "active", message: "OK", fields: [], steps: [] } };
    } });
    await service.sendFriendRequests(["p1"], "456");
    const repeat = await service.sendFriendRequests(["p1"], "456");
    assert.equal(posts, 1);
    assert.equal(repeat.result.profiles[0].code, "FRIEND_REQUEST_ALREADY_SENT");
    assert.equal((await store.snapshot()).friendRequests["p1:456"].success, true);
});

test("невідомий результат переживає перезапуск і помилку підготовки сесії", async (t) => {
    const store = await storeFixture(t);
    await store.add([{ profileId: "p1", profileNo: "1", name: "Test" }], "new");
    await store.beginFriendRequest("p1", "456");
    await store.recordAction("p1", { success: false, targetUserId: "456", message: "Session failed", attempted: false, fields: [], steps: [] });
    const reopened = new AutouploadStore(store.file);
    await assert.rejects(reopened.beginFriendRequest("p1", "456"), (error) => error.outcomeUnknown === true);
});

test("скасування під час POST зберігає невідомий результат і не запускає наступний профіль", async (t) => {
    const store = await storeFixture(t);
    await store.add([1, 2].map((id) => ({ profileId: `p${id}`, profileNo: String(id), name: "Test" })), "new");
    const controller = new AbortController();
    let prepared = 0;
    const service = new AutouploadService({ store, checkSession: async () => {
        prepared += 1;
        const { client } = await ready(() => { controller.abort(); throw new Error("aborted"); });
        return { client, result: { status: "active", message: "OK", fields: [], steps: [] } };
    } });
    const result = await service.sendFriendRequests(["p1", "p2"], "456", { signal: controller.signal });
    assert.equal(prepared, 1);
    assert.equal(result.result.profiles[0].outcomeUnknown, true);
    assert.equal((await store.snapshot()).friendRequests["p1:456"].outcomeUnknown, true);
});
