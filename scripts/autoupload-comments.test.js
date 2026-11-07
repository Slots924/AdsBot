import test from "node:test";
import assert from "node:assert/strict";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import createComment from "../facebook/autoupload/actions/comments/createComment.js";
import resolveCommentTarget from "../services/autoupload/resolveCommentTarget.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";
import AutouploadStore from "../services/autoupload/AutouploadStore.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { formatActionCounters, readActionCounters, incrementActionCounter } from "../services/profile/actionCounters.js";
import { withHttpWorkflow } from "../services/reports/HttpExchangeTrace.js";

async function directory(t) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "adsbot-comments-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith("adsbot-comments-"));
        await rm(dir, { recursive: true, force: true });
    });
    return dir;
}

async function batchFixture(t, execute, count = 4) {
    const store = new AutouploadStore(path.join(await directory(t), "state.json"));
    const profiles = Array.from({ length: count }, (_, i) => ({ profileId: `p${i + 1}`, profileNo: String(i + 1), name: `Profile ${i + 1} [AU_REPLY=2 AU_COMMENT=3]` }));
    await store.add(profiles, "new");
    const names = Object.fromEntries(profiles.map(p => [p.profileId, p.name]));
    const adsPower = { getProfileById: async id => ({ name: names[id] }), updateProfileName: async (id, name) => { names[id] = name; } };
    const service = new AutouploadService({ store, adsPower, createCommentFn: execute,
        prepareCommentSession: async ({ profileId }) => ({ client: { getFbData: () => ({ profileId }) }, result: { status: "active" } }),
    });
    return { store, service, profiles, adsPower, names };
}
const batchInput = { postUrl: "https://www.facebook.com/permalink.php?story_fbid=pfbidTest123&id=456", comments: ["First", "Second", "Third"] };

const feedbackId = Buffer.from("feedback:pfbidTest123").toString("base64");
const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
async function fixture(reply) {
    const calls = [];
    const client = new FacebookWebClient({ userAgent: "Test-UA",
        cookies: ["c_user", "xs"].map(name => ({ name, value: name === "c_user" ? "123" : "fake-xs", domain: ".facebook.com", path: "/", secure: true })),
        httpClient: { request: async (config, options) => {
            calls.push({ config, options });
            return config.method === "get" ? { status: 200, headers: {}, data: html } : reply(config);
        } },
    });
    await client.checkSession();
    return { fbData: client.getFbData("test"), calls };
}
const response = data => ({ status: 200, headers: {}, data: JSON.stringify(data) });

test("helper отримує ціль із permalink та відхиляє сторонні адреси", () => {
    assert.equal(resolveCommentTarget("https://www.facebook.com/permalink.php?story_fbid=pfbidTest123&id=456").feedbackId, feedbackId);
    assert.throws(() => resolveCommentTarget("https://example.com/permalink.php?story_fbid=pfbidTest123"));
});

test("коментар повертає ID і використовує готову сесію без додаткових GET", async () => {
    const { fbData, calls } = await fixture(() => response({ data: { comment_create: {
        feedback: { id: feedbackId }, feedback_comment_edge: { node: {
            id: "comment-graphql-id", legacy_fbid: "789", feedback: { id: "comment-feedback" }, body: { text: "Test" },
        } },
    } } }));
    const result = await createComment(fbData, { feedbackId, text: "Test" });
    assert.equal(result.success, true);
    assert.equal(result.legacyCommentId, "789");
    assert.equal(result.commentId, "comment-graphql-id");
    assert.equal(result.commentFeedbackId, "comment-feedback");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.retryOnConnectionError, false);
    assert.equal(JSON.parse(new URLSearchParams(calls[1].config.data).get("variables")).input.feedback_id, feedbackId);
    assert.equal(result.exchanges.length, 1);
    assert.ok(!JSON.stringify(result).includes("fake-dtsg"));
    assert.ok(!JSON.stringify(result).includes("fake-xs"));
});

test("відповідь без ID, невалідний JSON та timeout не повторюють mutation", async () => {
    for (const reply of [() => response({ data: { comment_create: {} } }),
        () => ({ status: 200, headers: {}, data: "invalid" }),
        () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); }]) {
        const { fbData, calls } = await fixture(reply);
        const result = await createComment(fbData, { feedbackId, text: "Test" });
        assert.equal(result.success, false);
        assert.equal(result.outcomeUnknown, true);
        assert.equal(calls.filter(call => call.config.method === "post").length, 1);
        assert.equal(result.exchanges.length, 1);
    }
});

test("явна GraphQL-відмова та скасування до відправлення мають відомий результат", async () => {
    const { fbData } = await fixture(() => response({ errors: [{ message: "Rejected", code: 123 }] }));
    const denied = await createComment(fbData, { feedbackId, text: "Test" });
    assert.equal(denied.success, false);
    assert.equal(denied.outcomeUnknown, false);
    assert.equal(denied.code, "FACEBOOK_GRAPHQL_ERROR");
    const cancelled = await createComment(fbData, { feedbackId, text: "Test" }, { signal: AbortSignal.abort() });
    assert.equal(cancelled.mutationAttempted, false);
});

test("черга залишає відмовлений коментар, пропускає невідомий і зберігає ID успіху", async t => {
    const attempts = [];
    const f = await batchFixture(t, async (fbData, input) => {
        attempts.push([fbData.profileId, input.text]);
        if (fbData.profileId === "p1") return { success: false, outcomeUnknown: false, message: "Відмова" };
        if (fbData.profileId === "p2") return { success: false, outcomeUnknown: true, message: "Timeout" };
        return { success: true, commentId: `id-${fbData.profileId}`, legacyCommentId: "789", message: "Створено" };
    });
    const result = await f.service.publishComments(f.profiles.map(p => p.profileId), batchInput);
    assert.deepEqual(attempts, [["p1", "First"], ["p2", "First"], ["p3", "Second"], ["p4", "Third"]]);
    assert.equal(result.result.publishedCount, 2);
    assert.equal(result.result.skippedCount, 1);
    assert.deepEqual(result.result.remaining, []);
    assert.equal(readActionCounters(f.names.p3).AU_COMMENT, 4);
    assert.equal(readActionCounters(f.names.p3).AU_REPLY, 2);
    assert.equal(readActionCounters(f.names.p1).AU_COMMENT, 3);
    assert.equal((await f.store.snapshot()).history.length, 4);
});

test("відсутня сесія не витрачає коментар; після вичерпання акаунтів повертається залишок", async t => {
    const f = await batchFixture(t, async () => { throw Error("Не повинно викликатися"); }, 1);
    f.service.prepareCommentSession = async () => ({ client: null, result: { status: "login_required", message: "Увійдіть" } });
    const value = await f.service.publishComments(["p1"], batchInput);
    assert.equal(value.result.remaining.length, 3);
    assert.equal(value.result.profiles[0].mutationAttempted, false);
});

test("успіх без ID пропускається, а скасування не запускає наступний акаунт", async t => {
    const controller = new AbortController();
    const f = await batchFixture(t, async () => { controller.abort(); return { success: true, message: "Без ID" }; });
    const value = await f.service.publishComments(["p1", "p2"], batchInput, { signal: controller.signal });
    assert.equal(value.result.profiles.length, 1);
    assert.equal(value.result.skippedCount, 1);
    assert.equal(value.result.remaining.length, 2);
    assert.equal(value.result.cancelled, true);
});

test("збій перейменування зберігає успіх, а повтор синхронізації не збільшує лічильник двічі", async t => {
    const f = await batchFixture(t, async () => ({ success: true, commentId: "id-one", message: "Створено" }), 1);
    const update = f.adsPower.updateProfileName;
    f.adsPower.updateProfileName = async () => { throw Error("Unavailable"); };
    const value = await f.service.publishComments(["p1"], { ...batchInput, comments: ["First"] });
    assert.equal(value.result.publishedCount, 1);
    assert.ok(value.result.profiles[0].counterWarning);
    f.adsPower.updateProfileName = update;
    await incrementActionCounter({ adsPower: f.adsPower, store: f.store, profileId: "p1", key: "AU_COMMENT", eventId: "id-one" });
    assert.equal(readActionCounters(f.names.p1).AU_COMMENT, 4);
    assert.equal((await f.store.snapshot()).history[0].commentId, "id-one");
});

test("лічильники підтримують старий формат і не обрізають довге ім’я", () => {
    assert.equal(formatActionCounters("Profile AU_COMMENT=1 [AU_REPLY=2]", { AU_COMMENT: 2, AU_REPLY: 2 }), "Profile [AU_COMMENT=2 AU_REPLY=2]");
    assert.throws(() => formatActionCounters("A".repeat(100), { AU_COMMENT: 1 }));
});

test("новий лічильник починається з 1 і не губить підтвердження при недоступному AdsPower", async t => {
    const f = await batchFixture(t, async () => ({}), 1);
    f.names.p1 = "Profile";
    await f.store.renameProfile("p1", "Profile");
    const read = f.adsPower.getProfileById;
    f.adsPower.getProfileById = async () => { throw Error("Unavailable"); };
    await assert.rejects(incrementActionCounter({ adsPower: f.adsPower, store: f.store, profileId: "p1", key: "AU_COMMENT", eventId: "first" }));
    f.adsPower.getProfileById = read;
    await incrementActionCounter({ adsPower: f.adsPower, store: f.store, profileId: "p1", key: "AU_COMMENT", eventId: "first" });
    assert.equal(f.names.p1, "Profile [AU_COMMENT=1]");
});

test("черга завершується після останнього коментаря без використання зайвих акаунтів", async t => {
    const attempts = [];
    const f = await batchFixture(t, async data => { attempts.push(data.profileId); return { success: true, commentId: "only-id", message: "Створено" }; });
    const value = await f.service.publishComments(["p1", "p2", "p3"], { ...batchInput, comments: ["Only"] });
    assert.deepEqual(attempts, ["p1"]);
    assert.equal(value.result.publishedCount, 1);
    assert.equal(value.taskStatus, "completed");
});

test("повна HTTP-історія зберігає ID та відповіді, приховуючи сесію", async t => {
    const { fbData } = await fixture(() => response({ data: { comment_create: { feedback_comment_edge: { node: { id: "saved-id", body: { text: "Test" } } } } } }));
    const value = await withHttpWorkflow("comment-test", () => createComment(fbData, { feedbackId, text: "Test" }), { directory: await directory(t) });
    const history = await readFile(value.httpHistory.path, "utf8");
    assert.ok(history.includes('"commentId":"saved-id"'));
    assert.ok(history.includes("request.finished"));
    assert.ok(!history.includes("fake-dtsg"));
    assert.ok(!history.includes("fake-xs"));
});

test("часткова відповідь з ID та помилкою має невідомий результат і не повторюється", async () => {
    const { fbData, calls } = await fixture(() => response({ data: { comment_create: { feedback_comment_edge: { node: { id: "maybe-created" } } } }, errors: [{ code: 123, message: "Partial" }] }));
    const value = await createComment(fbData, { feedbackId, text: "Test" });
    assert.equal(value.outcomeUnknown, true);
    assert.equal(calls.filter(call => call.config.method === "post").length, 1);
});
