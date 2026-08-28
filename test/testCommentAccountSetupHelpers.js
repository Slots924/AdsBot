import assert from "node:assert/strict";

import {
    BAN_TAG_ID,
    CHANGE_NAME_ERROR_TAG_ID,
    LOGIN_ERROR_TAG_ID,
    MAN_TAG_ID,
    WOMAN_TAG_ID,
} from "../config.js";
import buildAdsPowerProfileName from "../services/accounts/buildAdsPowerProfileName.js";
import getCommentAccountSetupSkipReason, {
    commentAccountSetupSkipReasons,
} from "../services/accounts/getCommentAccountSetupSkipReason.js";
import hasChangeNameErrorTag from "../services/profile/tags/hasChangeNameErrorTag.js";
import markProfileAsChangeNameError from "../services/profile/tags/markProfileAsChangeNameError.js";
import markProfileGender from "../services/profile/tags/markProfileGender.js";
import createRandomPostDates from "../services/accounts/randomPostDates.js";
import { facebookNameChangeStatuses } from "../facebook/actions/changeFacebookName.js";
import executeCommentAccountSetupWithProfile
    from "../workflows/accounts/executeCommentAccountSetupWithProfile.js";


assert.equal(CHANGE_NAME_ERROR_TAG_ID, "1478605");
assert.equal(
    buildAdsPowerProfileName({
        gender: "male",
        firstName: "Erick",
        lastName: "Kartmen",
    }),
    "m_Erick Kartmen"
);
assert.equal(
    buildAdsPowerProfileName({
        gender: "female",
        firstName: "Katty",
        lastName: "Perry",
    }),
    "f_Katty Perry"
);

const blankProfile = { profile_id: "p1", profile_tags: [] };
assert.equal(getCommentAccountSetupSkipReason(blankProfile), null);
assert.equal(
    getCommentAccountSetupSkipReason({
        profile_tags: [{ id: BAN_TAG_ID }],
    }),
    commentAccountSetupSkipReasons.BANNED
);
assert.equal(
    getCommentAccountSetupSkipReason({
        profile_tags: [{ id: LOGIN_ERROR_TAG_ID }],
    }),
    commentAccountSetupSkipReasons.LOGIN_ERROR
);
assert.equal(
    hasChangeNameErrorTag({
        profile_tags: [{ id: CHANGE_NAME_ERROR_TAG_ID }],
    }),
    true
);
assert.equal(
    getCommentAccountSetupSkipReason({
        profile_tags: [{ id: CHANGE_NAME_ERROR_TAG_ID }],
    }),
    commentAccountSetupSkipReasons.CHANGE_NAME_ERROR
);
assert.equal(
    getCommentAccountSetupSkipReason({
        profile_tags: [{ id: MAN_TAG_ID }],
    }),
    commentAccountSetupSkipReasons.ALREADY_SETUP
);
assert.equal(
    getCommentAccountSetupSkipReason({
        profile_tags: [{ id: WOMAN_TAG_ID }],
    }),
    commentAccountSetupSkipReasons.ALREADY_SETUP
);

const adsPower = {
    async updateProfileTags(profileId, tagIds, updateType) {
        this.last = { profileId, tagIds, updateType };
        return { ok: true };
    },
};
assert.deepEqual(
    await markProfileAsChangeNameError(adsPower, {
        profile_id: "abc",
        profile_tags: [],
    }),
    {
        added: true,
        alreadyMarked: false,
        tagId: CHANGE_NAME_ERROR_TAG_ID,
    }
);
assert.deepEqual(adsPower.last, {
    profileId: "abc",
    tagIds: [CHANGE_NAME_ERROR_TAG_ID],
    updateType: "2",
});
assert.equal(
    (await markProfileAsChangeNameError(adsPower, {
        profile_id: "abc",
        profile_tags: [{ id: CHANGE_NAME_ERROR_TAG_ID }],
    })).alreadyMarked,
    true
);
assert.deepEqual(
    await markProfileGender(adsPower, { profile_id: "abc", profile_tags: [] }, "female"),
    {
        added: true,
        alreadyMarked: false,
        tagId: WOMAN_TAG_ID,
        gender: "female",
    }
);

const dates = createRandomPostDates(3, {
    now: Date.parse("2026-08-25T00:00:00.000Z"),
    random: () => 0.5,
});
assert.equal(dates.length, 3);
assert.equal(dates[0] < dates[dates.length - 1] || dates.length === 3, true);
dates.forEach((value) => assert.match(value, /^\d{4}-\d{2}-\d{2}$/));

const skippedSetup = await executeCommentAccountSetupWithProfile({
    adsPower: {},
    profile: {
        profile_no: "99",
        profile_tags: [{ id: CHANGE_NAME_ERROR_TAG_ID }],
    },
    persona: createPersonaForSkip(),
});
assert.equal(skippedSetup.outcome, "skipped");
assert.match(skippedSetup.skipReason, /Change Name Error/);

const forcedSetup = await executeCommentAccountSetupWithProfile({
    adsPower: {},
    profile: {
        profile_no: "99",
        profile_tags: [{ id: CHANGE_NAME_ERROR_TAG_ID }],
    },
    persona: createPersonaForSkip(),
    skipNameChange: true,
    ignoreSkipReasons: true,
    actions: {
        ensureAdsPowerReady: async () => {
            throw new Error("stop-after-skip-name");
        },
    },
});
assert.equal(forcedSetup.outcome, "failed");
assert.equal(forcedSetup.error, "stop-after-skip-name");

let nameErrorTagged = false;
let profileClosed = false;
const nameButtonFailedSetup = await executeCommentAccountSetupWithProfile({
    adsPower: {
        async openProfile() {
            return { ws: { puppeteer: "ws://test" } };
        },
        async closeProfile() {
            profileClosed = true;
        },
    },
    profile: {
        profile_no: "77",
        profile_id: "id-77",
        profile_tags: [],
    },
    persona: createPersonaForSkip(),
    logger: { info() {}, warn() {}, error() {} },
    actions: {
        ensureAdsPowerReady: async () => true,
        connectBrowser: async () => ({
            async pages() {
                return [{
                    url() {
                        return "https://www.facebook.com/";
                    },
                }];
            },
            disconnect() {},
        }),
        openPage: async () => {},
        ensureLoggedIn: async () => true,
        ensureActive: async () => true,
        ensureEnglish: async () => {},
        changeName: async () => ({
            success: false,
            status: facebookNameChangeStatuses.NAME_BUTTON_FAILED,
            error: { message: "Не вдалося натиснути кнопку Name" },
        }),
        markChangeNameError: async () => {
            nameErrorTagged = true;
            return { added: true };
        },
    },
});
assert.equal(nameButtonFailedSetup.outcome, "failed");
assert.equal(nameButtonFailedSetup.success, false);
assert.equal(nameButtonFailedSetup.nameChanged, false);
assert.equal(
    nameButtonFailedSetup.error,
    "Не вдалося натиснути кнопку Name"
);
assert.equal(
    nameButtonFailedSetup.steps.name.status,
    facebookNameChangeStatuses.NAME_BUTTON_FAILED
);
assert.equal(nameErrorTagged, false);
assert.equal(profileClosed, true);

console.log("Перевірка хелперів оформлення акаунтів пройшла успішно");


function createPersonaForSkip() {
    return {
        gender: "male",
        firstName: "Holger",
        lastName: "Steinhof",
        bio: "bio",
        education: "school",
        work: { company: "Firma GmbH", position: "Mechaniker" },
    };
}
