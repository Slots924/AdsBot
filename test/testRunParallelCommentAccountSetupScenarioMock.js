import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    BAN_TAG_ID,
    CHANGE_NAME_ERROR_TAG_ID,
    MAN_TAG_ID,
} from "../config.js";
import runParallelCommentAccountSetupScenario
    from "../scenarios/runParallelCommentAccountSetupScenario.js";


const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createPersona(gender, firstName) {
    return {
        gender,
        firstName,
        lastName: `${firstName}son`,
        bio: `${firstName} bio`,
        education: `${firstName} school`,
        work: {
            company: `${firstName} GmbH`,
            position: "Mechaniker",
        },
    };
}


const profiles = {
    10: { profile_no: "10", profile_id: "id-10", profile_tags: [] },
    11: { profile_no: "11", profile_id: "id-11", profile_tags: [] },
    12: {
        profile_no: "12",
        profile_id: "id-12",
        profile_tags: [{ id: MAN_TAG_ID }],
    },
    13: {
        profile_no: "13",
        profile_id: "id-13",
        profile_tags: [{ id: CHANGE_NAME_ERROR_TAG_ID }],
    },
    14: {
        profile_no: "14",
        profile_id: "id-14",
        profile_tags: [{ id: BAN_TAG_ID }],
    },
};

const personas = [
    createPersona("male", "Holger"),
    createPersona("female", "Meike"),
];

const reportsDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-account-setup-")
);

try {
    const usedPersonas = [];
    const result = await runParallelCommentAccountSetupScenario({
        adsPower: {
            getProfileByNo: async (profileNo) => {
                const profile = profiles[String(profileNo)];
                if (!profile) throw new Error(`Немає профілю ${profileNo}`);
                return profile;
            },
        },
        profileNos: [10, 12, 13, 11, 14],
        personas,
        geo: "DE",
        concurrency: 2,
        reportsDirectory,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        executeSetup: async ({ profile, persona }) => {
            usedPersonas.push(`${profile.profile_no}:${persona.firstName}`);
            await wait(5);
            return {
                success: true,
                outcome: "success",
                profileNo: String(profile.profile_no),
                stage: "DONE",
                error: null,
                persona,
                adsPowerName: `${persona.gender === "female" ? "f_" : "m_"}${
                    persona.firstName
                } ${persona.lastName}`,
                nameChanged: true,
                steps: {
                    name: { ok: true, detail: persona.firstName },
                },
                cleanupErrors: [],
            };
        },
    });

    const outcomes = Object.fromEntries(
        result.report.profiles.map((item) => [item.profileNo, item.outcome])
    );
    assert.equal(outcomes["10"], "success");
    assert.equal(outcomes["11"], "success");
    assert.equal(outcomes["12"], "skipped");
    assert.equal(outcomes["13"], "skipped");
    assert.equal(outcomes["14"], "skipped");
    assert.equal(usedPersonas.length, 2);
    assert.ok(result.report.reportPath);
    assert.equal(result.report.geo, "DE");

    await assert.rejects(
        () => runParallelCommentAccountSetupScenario({
            adsPower: { getProfileByNo: async () => profiles[10] },
            profileNos: [10],
            personas,
            reportsDirectory,
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            executeSetup: async () => ({
                success: true,
                outcome: "success",
                profileNo: "10",
                cleanupErrors: [],
            }),
        }),
        { message: /дволітерним кодом країни/ }
    );

    const nameFailed = await runParallelCommentAccountSetupScenario({
        adsPower: {
            getProfileByNo: async () => profiles[10],
        },
        profileNos: [10],
        personas: [createPersona("male", "Lars")],
        geo: "US",
        reportsDirectory,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        executeSetup: async ({ persona }) => ({
            success: false,
            outcome: "failed",
            profileNo: "10",
            nameChanged: false,
            persona,
            error: "WHATSAPP_REQUIRED",
            steps: { name: { ok: false, error: "WHATSAPP_REQUIRED" } },
            cleanupErrors: [],
        }),
    });
    assert.equal(nameFailed.report.profiles[0].outcome, "failed");
    assert.equal(nameFailed.report.geo, "US");
} finally {
    await rm(reportsDirectory, { recursive: true, force: true });
}

console.log("Mock-перевірка сценарію оформлення акаунтів пройшла успішно");
