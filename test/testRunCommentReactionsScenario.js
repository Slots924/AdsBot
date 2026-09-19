import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import runCommentReactionsScenario, {
    createReactionQueue,
} from "../scenarios/runCommentReactionsScenario.js";


const reportsDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-comment-reactions-test-")
);

try {
    assert.deepEqual(
        createReactionQueue({ like: 0, love: 1, care: 2 }),
        ["love", "care", "care"]
    );

    const attempts = [];
    const outcomes = new Map([
        ["1118", 0],
        ["1119", 1],
        ["1218", 0],
        ["1378", 1],
        ["1385", 1],
    ]);
    const report = await runCommentReactionsScenario({
        adsPower: {
            async getProfileByNo(profileNo) {
                return { profile_no: profileNo };
            },
        },
        profileNos: ["1118", "1119", "1218", "1378", "1385"],
        postUrl: "https://www.facebook.com/test-post",
        reactions: { love: 1, care: 2 },
        reportsDirectory,
        async reactWithProfile({ profile, reaction }) {
            attempts.push([profile.profile_no, reaction]);
            const applied = outcomes.get(profile.profile_no);
            return {
                profileNo: profile.profile_no,
                reaction,
                outcome: applied ? "success" : "failed",
                applied,
                failed: applied ? 0 : 1,
                alreadyReacted: 0,
            };
        },
    });

    assert.deepEqual(attempts, [
        ["1118", "love"],
        ["1119", "love"],
        ["1218", "care"],
        ["1378", "care"],
        ["1385", "care"],
    ]);
    assert.equal(report.concurrency, 1);
    assert.deepEqual(report.unfulfilledReactions, { like: 0, love: 0, care: 0 });
    assert.deepEqual(report.unusedProfiles, []);
} finally {
    await rm(reportsDirectory, { recursive: true, force: true });
}

console.log("Comment reaction queue tests passed");
