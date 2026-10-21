import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import runSelectedProfilesCommentingScenario, { parseManualComments }
    from "../scenarios/runSelectedProfilesCommentingScenario.js";


const reportsDirectory = await mkdtemp(path.join(os.tmpdir(), "adsbot-selected-comments-"));
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const manualComments = "  перший комент\r\n\nце мій другий комент\rкоментую в третє  ";
assert.deepEqual(parseManualComments(manualComments).map((comment) => comment.text), [
    "перший комент", "це мій другий комент", "коментую в третє",
]);
assert(parseManualComments(manualComments).every((comment) => comment.parent_id === null && comment.gender === null));

try {
    const attempts = [];
    const loaded = [];
    const activeProfiles = new Set();
    let active = 0;
    let peak = 0;
    const { report } = await runSelectedProfilesCommentingScenario({
        adsPower: {
            async getProfileByNo(number) {
                loaded.push(number);
                return { profile_no: number, profile_tags: [] };
            },
            getProfilesByGroupId() { assert.fail("Не можна брати невибрані акаунти з груп"); },
        },
        profileNos: [1, 2, 3, 4, 4],
        manualMode: true,
        manualComments,
        postUrl: "https://www.facebook.com/test/posts/1",
        concurrency: 2,
        browserMode: "headless",
        disableImages: true,
        workerProxies: { 1: { type: "http", id: "proxy-1" }, 2: { type: "http", id: "proxy-2" } },
        reportsDirectory,
        logger,
        async executeComment({ profile, comment, browserMode, disableImages, workerId, workerProxy }) {
            assert.equal(browserMode, "headless");
            assert.equal(disableImages, true);
            assert.equal(workerProxy.id, `proxy-${workerId}`);
            assert(!activeProfiles.has(profile.profile_no));
            activeProfiles.add(profile.profile_no);
            active += 1;
            peak = Math.max(peak, active);
            attempts.push({ commentId: comment.id, profileNo: profile.profile_no });
            const success = attempts.length !== 1;
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            activeProfiles.delete(profile.profile_no);
            return { success, profileNo: profile.profile_no, commentId: comment.id, error: success ? null : "Не вдалося написати", cleanupErrors: [] };
        },
    });
    assert.deepEqual(loaded.sort(), ["1", "2", "3", "4"]);
    assert.equal(attempts.length, 4);
    assert.equal(new Set(attempts.map((attempt) => attempt.profileNo)).size, 4);
    assert.equal(report.published.length, 3);
    assert.equal(report.failedProfiles.length, 1);
    assert.equal(report.failedComments.length, 0);
    assert.equal(report.excludedProfiles.length, 0);
    assert.equal(attempts.filter((attempt) => attempt.commentId === attempts[0].commentId).length, 2);
    assert.equal(peak, 2);
    assert((await readFile(report.reportPath, "utf8")).includes("це мій другий комент"));

    const exhausted = await runSelectedProfilesCommentingScenario({
        adsPower: { getProfileByNo: async () => ({ profile_no: "1" }) },
        profileNos: [1], manualMode: true, manualComments,
        postUrl: "https://www.facebook.com/test/posts/1", reportsDirectory, logger,
        executeComment: async () => ({ success: false, error: "Помилка", cleanupErrors: [] }),
    });
    assert.equal(exhausted.report.failedComments.length, 3);
    assert.equal(exhausted.report.failedProfiles.length, 1);
    assert(exhausted.report.reportPath);

    const creativeAttempts = [];
    const creativeResult = await runSelectedProfilesCommentingScenario({
        adsPower: { getProfileByNo: async (number) => ({ profile_no: number, gender: number === "1" ? "male" : "female" }) },
        profileNos: [1, 2], geo: "HU", creativeName: "139",
        comments: [
            { id: "1", text: "Коментар", gender: "female", should_write: true, parent_id: null, profile_key: "author" },
            { id: "2", text: "Відповідь", gender: "female", should_write: true, parent_id: "1", profile_key: "author" },
        ],
        getGender: (profile) => profile.gender,
        postUrl: "https://www.facebook.com/test/posts/1", reportsDirectory, logger,
        executeComment: async ({ profile, parentComment }) => {
            assert.equal(profile.gender, "female");
            creativeAttempts.push({ profileNo: profile.profile_no, parent: parentComment?.id });
            return { success: true, profileNo: profile.profile_no, cleanupErrors: [] };
        },
    });
    assert.equal(creativeResult.report.published.length, 2);
    assert.deepEqual(creativeAttempts, [{ profileNo: "2", parent: undefined }, { profileNo: "2", parent: "1" }]);

    const controller = new AbortController();
    await assert.rejects(runSelectedProfilesCommentingScenario({
        adsPower: { getProfileByNo: async () => ({ profile_no: "1" }) },
        profileNos: [1], manualMode: true, manualComments,
        postUrl: "https://www.facebook.com/test/posts/1", reportsDirectory, logger,
        signal: controller.signal,
        executeComment: async () => {
            controller.abort();
            return { success: false, aborted: true, cleanupErrors: [] };
        },
    }), (error) => error.name === "AbortError" && error.report.interrupted && Boolean(error.report.reportPath));
} finally {
    await rm(reportsDirectory, { recursive: true, force: true });
}

console.log("Перевірка коментування вибраними профілями пройшла успішно");
