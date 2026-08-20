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

console.log("Mock-перевірка паралельного коментування пройшла успішно");
