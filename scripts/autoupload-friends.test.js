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
import getIncomingFriendRequests from "../facebook/autoupload/actions/friends/getIncomingFriendRequests.js";
import acceptFriendRequest from "../facebook/autoupload/actions/friends/acceptFriendRequest.js";
import acceptIncomingFriendRequest from "../facebook/autoupload/actions/friends/acceptIncomingFriendRequest.js";

const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const cookies = ["c_user", "xs"].map((name) => ({ name, value: name === "c_user" ? "123" : "fake-xs", domain: ".facebook.com", path: "/", session: true, secure: true }));
const recipient = (id = "456", status = "OUTGOING_REQUEST") => ({ data: { friend_request_send: { friend_requestees: [{ id, friendship_status: status }] } } });
const response = (body, status = 200) => ({ status, headers: {}, data: typeof body === "string" ? body : JSON.stringify(body) });
async function ready(send, home = html, friendsHtml = home) {
    const calls = [];
    const client = new FacebookWebClient({ cookies, userAgent: "Test-UA", httpClient: {
        request: async (config, options) => {
            if (config.method === "get") return response(config.url === "https://www.facebook.com/friends" ? friendsHtml : home);
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

const incoming = ({ ids = ["456"], hasNextPage = false, count = ids.length } = {}) => ({ viewer: {
    friends_container_request_count: { count }, friend_requests: {
        edges: ids.map((id) => ({ node: { id, name: "Test requester", friendship_status: "INCOMING_REQUEST" }, cursor: id })),
        page_info: { has_next_page: hasNextPage, end_cursor: ids.at(-1) ?? null },
    },
} });
const friendsHtml = (data) => `<script type="application/json">${JSON.stringify({ require: [[{ __bbox: { result: { data } } }]] })}</script>`;
const accepted = (id = "456", status = "ARE_FRIENDS") => ({ data: { friend_request_accept: { friend_requester: { id, friendship_status: status } } } });

test("вхідні заявки завантажуються GraphQL-запитом, який не є mutation", async () => {
    const { fbData, calls } = await ready(() => response({ data: incoming() }));
    const result = await getIncomingFriendRequests(fbData);
    assert.equal(result.success, true);
    assert.equal(result.source, "graphql");
    assert.equal(result.loadedCount, 1);
    assert.equal(result.totalCount, 1);
    assert.equal(result.incomplete, false);
    assert.equal(result.requests[0].status, "INCOMING_REQUEST");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.retryOnConnectionError, true);
    assert.equal(calls[0].config.headers["Sec-Fetch-Mode"], "cors");
    assert.equal(new URLSearchParams(calls[0].config.data).get("fb_api_req_friendly_name"), "FriendingCometRootContentQuery");
});

test("непідтримуваний GraphQL переходить до JSON у HTML без виконання script", async () => {
    const page = '<script type="application/json">broken</script><script>throw new Error("must not run")</script>' + friendsHtml(incoming());
    const { fbData, calls } = await ready(() => response({ errors: [{ message: "Unsupported query", code: 123 }] }), html, page);
    const result = await getIncomingFriendRequests(fbData);
    assert.equal(result.success, true);
    assert.equal(result.source, "html");
    assert.equal(result.requests[0].id, "456");
    assert.equal(result.diagnostics[0].graphCode, 123);
    assert.equal(result.diagnostics[0].outcomeUnknown, false);
    assert.equal(calls.length, 1);
});

test("порожній список є успіхом, а відсутність edges не маскується нульовою кількістю", async () => {
    const empty = await ready(() => response({ data: incoming({ ids: [] }) }));
    const result = await getIncomingFriendRequests(empty.fbData);
    assert.equal(result.success, true);
    assert.equal(result.loadedCount, 0);
    assert.equal(result.incomplete, false);
    const missing = await ready(() => response({ data: { viewer: {} } }), html, "<html></html>");
    const failure = await getIncomingFriendRequests(missing.fbData);
    assert.equal(failure.success, false);
    assert.equal(failure.code, "FACEBOOK_INCOMING_REQUESTS_NOT_FOUND");
    assert.equal(failure.diagnostics.length, 1);
});

test("пагінація та невідомий page_info повертають incomplete без вигаданих параметрів", async () => {
    const data = incoming({ hasNextPage: true, count: 5 });
    const first = await ready(() => response({ data }));
    const result = await getIncomingFriendRequests(first.fbData);
    assert.equal(result.hasNextPage, true);
    assert.equal(result.incomplete, true);
    assert.equal(result.totalCount, 5);
    assert.equal(first.calls.length, 1);
    delete data.viewer.friend_requests.page_info;
    const unknown = await ready(() => response({ data }));
    assert.equal((await getIncomingFriendRequests(unknown.fbData)).incomplete, true);
});

test("рекомендації не стають заявками, а дублікати preload об'єднуються", async () => {
    const data = incoming();
    data.viewer.friend_requests.edges.push({ node: { id: "789", name: "Other", friendship_status: "ARE_FRIENDS" } });
    const page = friendsHtml({ suggestion: { edges: [{ node: { id: "999", friendship_status: "INCOMING_REQUEST" } }] }, one: data, two: data });
    const { fbData } = await ready(() => { throw new Error("should not query"); }, html, page);
    const result = await getIncomingFriendRequests(fbData, { source: "html" });
    assert.equal(result.loadedCount, 1);
    assert.deepEqual(result.requests.map((item) => item.id), ["456"]);
});

test("прийняття перевіряє точний ID та ARE_FRIENDS і не надсилає вигаданого click proof", async () => {
    const { fbData, calls } = await ready(() => response(accepted()));
    const result = await acceptFriendRequest(fbData, "456");
    assert.equal(result.success, true);
    assert.equal(result.outcome, "FRIEND_REQUEST_ACCEPTED");
    assert.equal(result.friendship_status, "ARE_FRIENDS");
    const variables = JSON.parse(new URLSearchParams(calls[0].config.data).get("variables"));
    assert.equal(variables.input.friend_requester_id, "456");
    assert.equal(variables.input.actor_id, "123");
    assert.equal(variables.input.friending_channel, "FRIENDS_HOME_MAIN");
    assert.equal(variables.input.click_proof_validation_result, undefined);
    assert.equal(calls[0].options.retryOnConnectionError, false);
    for (const payload of [accepted("789"), accepted("456", "INCOMING_REQUEST"), { is_final: true }]) {
        const attempt = await ready(() => response(payload));
        const failure = await acceptFriendRequest(attempt.fbData, "456");
        assert.equal(failure.success, false);
        assert.equal(failure.outcomeUnknown, true);
    }
});

test("часткова відповідь прийняття з errors не підтверджує успіх", async () => {
    const { fbData } = await ready(() => response({ ...accepted(), errors: [{ message: "Partial", code: 45, api_error_code: 67 }] }));
    const result = await acceptFriendRequest(fbData, "456");
    assert.equal(result.success, false);
    assert.equal(result.graphCode, 45);
    assert.equal(result.apiErrorCode, 67);
    assert.equal(result.outcomeUnknown, true);
});

test("складена дія читає та приймає лише обрану заявку без вкладеної черги", async () => {
    const { fbData, calls } = await ready((config) => {
        const name = new URLSearchParams(config.data).get("fb_api_req_friendly_name");
        return response(name === "FriendingCometRootContentQuery" ? { data: incoming({ ids: ["456", "789"] }) } : accepted());
    });
    const result = await acceptIncomingFriendRequest(fbData, "456");
    assert.equal(result.success, true);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(new URLSearchParams(calls[1].config.data).get("variables")).input.friend_requester_id, "456");
});

test("відсутній ID у неповному списку не вважається відсутньою заявкою і не приймається", async () => {
    for (const hasNextPage of [true, false]) {
        const { fbData, calls } = await ready(() => response({ data: incoming({ ids: ["789"], hasNextPage }) }));
        const result = await acceptIncomingFriendRequest(fbData, "456");
        assert.equal(result.success, false);
        assert.equal(result.code, hasNextPage ? "FACEBOOK_INCOMING_REQUESTS_INCOMPLETE" : "FACEBOOK_INCOMING_REQUEST_NOT_FOUND");
        assert.equal(result.outcomeUnknown, false);
        assert.equal(calls.length, 1);
    }
});

test("відома заявка в неповному списку може бути прийнята окремо", async () => {
    const { fbData } = await ready((config) => response(new URLSearchParams(config.data).get("fb_api_req_friendly_name") === "FriendingCometRootContentQuery" ? { data: incoming({ hasNextPage: true, count: 4 }) } : accepted()));
    const result = await acceptIncomingFriendRequest(fbData, "456");
    assert.equal(result.success, true);
    assert.equal(result.incomingIncomplete, true);
});

test("прийняття не повторює POST при timeout, а скасування не запускає mutation", async () => {
    const attempt = await ready(() => { throw new Error("private-network-value"); });
    const result = await acceptFriendRequest(attempt.fbData, "456");
    assert.equal(result.outcomeUnknown, true);
    assert.equal(attempt.calls.length, 1);
    assert.ok(!JSON.stringify(result).includes("private-network-value"));
    const controller = new AbortController();
    controller.abort();
    const cancelled = await ready(() => response(accepted()));
    assert.equal((await acceptFriendRequest(cancelled.fbData, "456", { signal: controller.signal })).code, "TASK_INTERRUPTED");
    assert.equal(cancelled.calls.length, 0);
});
