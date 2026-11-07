import test from "node:test";
import assert from "node:assert/strict";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import createComment from "../facebook/autoupload/actions/comments/createComment.js";
import resolveCommentTarget from "../services/autoupload/resolveCommentTarget.js";

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
