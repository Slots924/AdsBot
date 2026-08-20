import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import runCommentingScenario
    from "../scenarios/runCommentingScenario.js";


const reportsDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-commenting-scenario-test-")
);

try {
    let getProfilesCalls = 0;
    const adsPower = {
        async getProfilesByGroupId() {
            getProfilesCalls += 1;

            return [{
                profile_no: "test-profile",
                profile_tags: [],
            }];
        },
    };
    const comments = [{
        id: " 1 ",
        parent_id: null,
        text: "Коментар для перевірки",
        gender: " MALE ",
        profile_key: " test-key ",
        is_author: false,
        should_write: false,
    }];
    const { report, reportPath } = await runCommentingScenario({
        adsPower,
        groupIds: ["test-group"],
        comments,
        geo: " cz ",
        creativeName: " 138 ",
        postUrl: "https://www.facebook.com/test-post",
        browserMode: "headless",
        disableImages: true,
        reportsDirectory,
    });

    assert.equal(getProfilesCalls, 1);
    assert.equal(report.fatalError, null);
    assert.equal(report.geo, "CZ");
    assert.equal(report.creativeName, "138");
    assert.equal(report.browserMode, "headless");
    assert.equal(report.disableImages, true);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].commentId, "1");
    assert.equal(report.skipped[0].reason, "should_write=false");

    const markdownReport = await readFile(reportPath, "utf8");
    assert(markdownReport.includes("Креатив: CZ 138"));
    assert(markdownReport.includes("Режим браузера: Headless"));
    assert(markdownReport.includes("Зображення: вимкнені"));
    assert(!markdownReport.includes("Файл коментарів"));

    let unexpectedAdsPowerCalls = 0;
    const unusedAdsPower = {
        async getProfilesByGroupId() {
            unexpectedAdsPowerCalls += 1;
            return [];
        },
    };
    const invalidCommentsResult = await runCommentingScenario({
        adsPower: unusedAdsPower,
        groupIds: ["test-group"],
        comments: null,
        geo: "US",
        creativeName: "138",
        postUrl: "https://www.facebook.com/test-post",
        reportsDirectory,
    });

    assert.equal(unexpectedAdsPowerCalls, 0);
    assert.equal(
        invalidCommentsResult.report.fatalError,
        "Коментарі мають бути масивом"
    );

    const missingGeoResult = await runCommentingScenario({
        adsPower: unusedAdsPower,
        groupIds: ["test-group"],
        comments: [],
        geo: "",
        creativeName: "138",
        postUrl: "https://www.facebook.com/test-post",
        reportsDirectory,
    });

    assert.equal(missingGeoResult.report.fatalError, "Не вказано geo креативу");

    const missingNameResult = await runCommentingScenario({
        adsPower: unusedAdsPower,
        groupIds: ["test-group"],
        comments: [],
        geo: "US",
        creativeName: "",
        postUrl: "https://www.facebook.com/test-post",
        reportsDirectory,
    });

    assert.equal(
        missingNameResult.report.fatalError,
        "Не вказано назву креативу"
    );
    assert.equal(unexpectedAdsPowerCalls, 0);
} finally {
    await rm(reportsDirectory, { recursive: true, force: true });
}

console.log("Mock-перевірка runCommentingScenario пройшла успішно");
