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
import { HUMAN_CONFIRMATION_REQUIRED } from "../facebook/session/sessionStatus.js";
import { BAN_TAG_ID } from "../config.js";
import { defaultProfileActivityStore } from "../services/profile/ProfileActivityStore.js";

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
test("AU Comments ставить BAN при підтвердженні людини та рахує лише успіх наступного акаунта", async t => {
    const sync = defaultProfileActivityStore.syncProfileGroups;
    const mark = defaultProfileActivityStore.markBanned;
    defaultProfileActivityStore.syncProfileGroups = async () => {};
    defaultProfileActivityStore.markBanned = async () => {};
    t.after(() => {
        defaultProfileActivityStore.syncProfileGroups = sync;
        defaultProfileActivityStore.markBanned = mark;
    });
    for (const stage of ["session", "mutation"]) {
        const f = await batchFixture(t, async () => ({}));
        const profiles = ["blocked", "active"].map(id => ({ profileId: id, profileNo: id, gender: "male", name: "Тест" }));
        const names = { blocked: "Тест", active: "Тест [AU_COMMENT=2]" };
        const bans = [];
        f.adsPower.getProfileById = async id => ({ profile_id: id, profile_no: id, name: names[id], profile_tags: [] });
        f.adsPower.updateProfileTags = async (...args) => bans.push(args);
        f.adsPower.updateProfileName = async (id, name) => { names[id] = name; };
        const failure = { success: false, status: HUMAN_CONFIRMATION_REQUIRED, sessionStatus: HUMAN_CONFIRMATION_REQUIRED, outcomeUnknown: false, message: "Підтвердіть, що ви людина" };
        f.service.prepareCommentSession = async ({ profileId }) => profileId === "blocked" && stage === "session"
            ? { client: null, result: failure }
            : { client: { getFbData: () => ({ profileId }) }, result: { status: "active" } };
        const attempts = [];
        f.service.createCommentFn = async (data, input) => {
            attempts.push([data.profileId, input.text]);
            return data.profileId === "blocked" ? failure : { success: true, commentId: "confirmed-id" };
        };
        const result = await f.service.publishComments(profiles.map(p => p.profileId), { ...batchInput, comments: ["Текст"] }, {
            profiles, commentRows: [{ gender: "male" }],
        });
        assert.deepEqual(bans, [["blocked", [BAN_TAG_ID], "2"]]);
        assert.equal(result.result.profiles[0].banTag.added, true);
        assert.deepEqual(attempts.at(-1), ["active", "Текст"]);
        assert.equal(result.result.publishedCount, 1);
        assert.equal(names.blocked, "Тест");
        assert.equal(names.active, "Тест [AU_COMMENT=3]");
        assert.equal((await f.store.snapshot()).actionCounters.blocked, undefined);
    }
});

test("збій AdsPower після успіху зберігає лічильник навіть для профілю поза списком AU", async t => {
    const f = await batchFixture(t, async () => ({ success: true, commentId: "confirmed-external" }));
    f.adsPower.getProfileById = async () => { throw new Error("Недоступний"); };
    const profile = { profileId: "external", profileNo: "99", gender: "male", name: "Тест" };
    const result = await f.service.publishComments([profile.profileId], { ...batchInput, comments: ["Текст"] }, { profiles: [profile] });
    assert.equal(result.result.publishedCount, 1);
    assert.ok(result.result.profiles[0].counterWarning);
    assert.equal((await f.store.snapshot()).actionCounters.external.values.AU_COMMENT, 1);
});
test("акаунти поза вкладкою AU підбираються за статтю, відмова передає коментар наступному", async t => {
    const f = await batchFixture(t, async () => ({}));
    const profiles = [
        { profileId: "x1", profileNo: "91", name: "Тест", gender: "male" },
        { profileId: "x2", profileNo: "92", name: "Тест", gender: "female" },
        { profileId: "x3", profileNo: "93", name: "Тест", gender: "female" },
    ];
    const attempts = [];
    f.adsPower.getProfileById = async () => ({ name: "Тест" });
    f.service.createCommentFn = async (data, input) => {
        attempts.push([data.profileId, input.text]);
        return data.profileId === "x2" ? { success: false, outcomeUnknown: false }
            : { success: true, commentId: `id-${data.profileId}` };
    };
    const value = await f.service.publishComments(profiles.map(p => p.profileId), batchInput, {
        profiles, commentRows: [{ gender: "female" }, { gender: "female" }, { gender: "male" }],
    });
    assert.deepEqual(attempts, [["x2", "First"], ["x3", "First"], ["x1", "Third"]]);
    assert.equal(value.result.publishedCount, 2);
    assert.equal(value.result.skippedCount, 1);
    const state = await f.store.snapshot();
    assert.equal(state.profiles.length, 4);
    assert.equal(state.history.filter(row => row.profileId.startsWith("x")).length, 3);
    assert.equal(state.actionCounters.x3.values.AU_COMMENT, 1);
});
const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
async function fixture(reply, actorId = "123") {
    const calls = [];
    const client = new FacebookWebClient({ userAgent: "Test-UA",
        cookies: ["c_user", "xs"].map(name => ({ name, value: name === "c_user" ? "123" : "fake-xs", domain: ".facebook.com", path: "/", secure: true })),
        httpClient: { request: async (config, options) => {
            calls.push({ config, options });
            return config.method === "get" ? { status: 200, headers: {}, data: html.replace('"actorID":"123"', `"actorID":"${actorId}","ACCOUNT_ID":"123"`) } : reply(config);
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

test("коментар надсилається від активної фанки без перемикання на соц", async () => {
    const { fbData, calls } = await fixture(() => response({ data: { comment_create: {
        feedback: { id: feedbackId }, feedback_comment_edge: { node: { id: "comment-id" } },
    } } }), "456");
    const result = await createComment(fbData, { feedbackId, text: "Test" });
    assert.equal(result.success, true);
    const form = new URLSearchParams(calls[1].config.data);
    assert.equal(form.get("av"), "456");
    assert.equal(form.get("__user"), "456");
    assert.throws(() => fbData.client.validateFbData(fbData), { code: "FACEBOOK_SOCIAL_CONTEXT_REQUIRED" });
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
    const { fbData } = await fixture(() => response({ data: { comment_create: { feedback: { id: feedbackId }, feedback_comment_edge: { node: { id: "saved-id", body: { text: "Test" } } } } } }));
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
