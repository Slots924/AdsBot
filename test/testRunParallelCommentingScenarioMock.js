import assert from "node:assert/strict";

import runParallelCommentingScenario
    from "../scenarios/runParallelCommentingScenario.js";


const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const profiles = Array.from({ length: 8 }, (_, index) => ({
    profile_no: String(index + 1),
    gender: index < 6 ? "male" : "female",
}));
const comments = [
    { id: "1", parent_id: null, text: "root slow", gender: "male", should_write: true, profile_key: "slow" },
    { id: "2", parent_id: null, text: "root fast", gender: "male", should_write: true, profile_key: "thread" },
    { id: "2.1", parent_id: "2", text: "reply one", gender: "male", should_write: true, profile_key: "thread" },
    { id: "2.2", parent_id: "2", text: "reply two", gender: "male", should_write: true, profile_key: "thread" },
    { id: "3", parent_id: null, text: "another root", gender: "female", should_write: true, profile_key: null },
];
const events = [];
const activeProfiles = new Map();
let duplicateProfileUse = false;
let active = 0;
let maximumActive = 0;

const result = await runParallelCommentingScenario({
    adsPower: { getProfilesByGroupId: async () => profiles },
    groupIds: ["group-1"],
    comments,
    geo: "HU",
    creativeName: "parallel-test",
    postUrl: "https://www.facebook.com/test/posts/1",
    concurrency: 3,
    getGender: (profile) => profile?.gender ?? null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    executeComment: async ({ profile, comment, parentComment }) => {
        if (comment.parent_id !== null) {
            assert(parentComment);
            assert(events.includes(`end:${comment.parent_id}`));
        }
        const profileNo = String(profile.profile_no);
        if ((activeProfiles.get(profileNo) ?? 0) > 0) duplicateProfileUse = true;
        activeProfiles.set(profileNo, (activeProfiles.get(profileNo) ?? 0) + 1);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        events.push(`start:${comment.id}`);
        await wait(comment.id === "1" ? 80 : 5);
        events.push(`end:${comment.id}`);
        active -= 1;
        activeProfiles.set(profileNo, activeProfiles.get(profileNo) - 1);
        return { success: true, profileNo, commentId: comment.id, cleanupErrors: [] };
    },
});

assert.equal(result.report.published.length, comments.length);
assert(maximumActive > 1);
assert(maximumActive <= 3);
assert.equal(duplicateProfileUse, false);
assert(events.indexOf("start:2.1") > events.indexOf("end:2"));
assert(events.indexOf("start:2.1") < events.indexOf("end:1"));
assert.equal(result.report.profileKeyMap.thread, result.report.published
    .find((item) => item.commentId === "2").profileNo);

const controller = new AbortController();
let opened = 0;
const cancelled = runParallelCommentingScenario({
    adsPower: { getProfilesByGroupId: async () => profiles },
    groupIds: ["group-1"],
    comments: comments.slice(0, 2),
    geo: "HU",
    creativeName: "cancel-test",
    postUrl: "https://www.facebook.com/test/posts/1",
    signal: controller.signal,
    getGender: (profile) => profile?.gender ?? null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    executeComment: ({ signal }) => new Promise((resolve) => {
        opened += 1;
        signal.addEventListener("abort", () => resolve({
            success: false,
            aborted: true,
            cleanupErrors: [],
        }), { once: true });
    }),
});

while (!opened) await wait(1);
controller.abort();
await assert.rejects(cancelled, (error) => (
    error.name === "AbortError" && error.report?.interrupted === true
));

const limited = await runParallelCommentingScenario({
    adsPower: { getProfilesByGroupId: async () => profiles },
    groupIds: ["group-1"],
    comments: comments.slice(0, 2),
    geo: "HU",
    creativeName: "worker-proxy-test",
    postUrl: "https://www.facebook.com/test/posts/1",
    concurrency: 5,
    workerProxies: {
        1: { id: "proxy-001", type: "socks5", host: "a.example.com", port: "1" },
        3: { id: "proxy-003", type: "socks5", host: "c.example.com", port: "3" },
    },
    getGender: (profile) => profile?.gender ?? null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    executeComment: async ({ workerId, workerProxy }) => {
        assert.ok([1, 3].includes(workerId));
        assert.ok(workerProxy?.id);
        return {
            success: true,
            profileNo: "1",
            commentId: "ok",
            cleanupErrors: [],
        };
    },
});
assert.equal(limited.report.concurrency, 2);
assert.equal(limited.report.published.length, 2);

const skippedProxy = await runParallelCommentingScenario({
    adsPower: { getProfilesByGroupId: async () => profiles },
    groupIds: ["group-1"],
    comments: [{
        id: "skip-1",
        parent_id: null,
        text: "root",
        gender: "male",
        should_write: true,
        profile_key: null,
    }],
    geo: "HU",
    creativeName: "skip-proxy-test",
    postUrl: "https://www.facebook.com/test/posts/1",
    concurrency: 1,
    workerProxies: {
        1: { id: "proxy-001", type: "socks5", host: "a.example.com", port: "1" },
    },
    getGender: (profile) => profile?.gender ?? null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    executeComment: async () => ({
        success: false,
        skippedDueToProxy: true,
        error: "Коментар пропущено через проксі воркера",
        cleanupErrors: [],
    }),
});
assert.equal(skippedProxy.report.published.length, 0);
assert.equal(skippedProxy.report.failedComments.length, 0);
assert.equal(skippedProxy.report.skipped.length, 1);

let postOpenAttempts = 0;
const retryAfterPostOpenFailure = await runParallelCommentingScenario({
    adsPower: {
        getProfilesByGroupId: async () => [
            { profile_no: "first", gender: "male" },
            { profile_no: "second", gender: "male" },
        ],
    },
    groupIds: ["group-1"],
    comments: [{
        id: "retry-post-open",
        parent_id: null,
        text: "root",
        gender: "male",
        should_write: true,
        profile_key: null,
    }],
    geo: "HU",
    creativeName: "retry-post-open",
    postUrl: "https://www.facebook.com/test/posts/1",
    concurrency: 1,
    getGender: (profile) => profile?.gender ?? null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    executeComment: async () => {
        postOpenAttempts += 1;
        return postOpenAttempts === 1
            ? {
                success: false,
                stage: "OPEN_POST_VIA_AUTHOR_PAGE",
                error: "Не вдалося відкрити потрібний Facebook-допис: first_post_not_found",
                cleanupErrors: [],
            }
            : { success: true, cleanupErrors: [] };
    },
});
assert.equal(retryAfterPostOpenFailure.report.published.length, 1);
assert.equal(postOpenAttempts, 2);
assert.equal(retryAfterPostOpenFailure.report.failedProfiles.length, 1);
assert.equal(retryAfterPostOpenFailure.report.fatalError, null);

const emptyWorkers = await runParallelCommentingScenario({
    adsPower: { getProfilesByGroupId: async () => profiles },
    groupIds: ["group-1"],
    comments: comments.slice(0, 1),
    geo: "HU",
    creativeName: "empty-workers",
    postUrl: "https://www.facebook.com/test/posts/1",
    workerProxies: {},
    getGender: (profile) => profile?.gender ?? null,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    executeComment: async () => ({ success: true, cleanupErrors: [] }),
});
assert.match(emptyWorkers.report.fatalError, /призначеною проксі/);

console.log("Mock-перевірка паралельного коментування пройшла успішно");
