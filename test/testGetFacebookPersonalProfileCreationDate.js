import assert from "node:assert/strict";

import getFacebookPersonalProfileCreationDate, {
    facebookPersonalProfileCreationDateStatuses,
    parseFacebookJoinedDate,
} from "../facebook/actions/getFacebookPersonalProfileCreationDate.js";
import {
    personalProfileHeaderActionSelector,
    personalProfileInformationCloseButtonSelector,
    personalProfileInformationDialogSelector,
    personalProfileNameButtonCandidatesSelector,
    personalProfileTimelineLinkSelector,
} from "../facebook/selectors/personalProfileCreationDate.js";


function createHandle(state, kind) {
    return {
        kind,
        asElement() { return this; },
        async dispose() {},
        async evaluate() {},
        async boundingBox() {
            state.currentTarget = kind;
            return { x: 100, y: 80, width: 220, height: 48 };
        },
    };
}


function createNullHandle() {
    return {
        asElement() { return null; },
        async dispose() {},
    };
}


function createMockPage({
    existingText = null,
    profileName = "Adi Chandra",
    triggerAvailable = true,
    dialogOpens = true,
    dialogText = "Joined Facebook: December 11, 2025",
    closeFails = false,
} = {}) {
    const state = {
        existingText,
        profileName,
        triggerAvailable,
        dialogOpens,
        dialogText,
        closeFails,
        dialogVisible: false,
        currentTarget: null,
        triggerFinds: 0,
        triggerClicks: 0,
        closeClicks: 0,
    };

    return {
        state,
        url() {
            return "https://www.facebook.com/profile.php?id=61584835263222";
        },
        async evaluate(callback, ...args) {
            if (callback.name === "readJoinedFacebookTextInBrowser") {
                return args[0]
                    ? state.dialogVisible ? state.dialogText : null
                    : state.existingText;
            }
            if (callback.name === "readProfileNameInBrowser") {
                return state.profileName;
            }
            if (callback.name === "verifyTargetUnderPointerInBrowser") {
                return true;
            }
            if (args.length === 0) {
                return { width: 1280, height: 900 };
            }
            return null;
        },
        async evaluateHandle(callback) {
            if (callback.name === "findProfileTriggerInBrowser") {
                state.triggerFinds += 1;
                return state.triggerAvailable
                    ? createHandle(state, "trigger")
                    : createNullHandle();
            }
            if (callback.name === "findInfoCloseButtonInBrowser") {
                return state.dialogVisible
                    ? createHandle(state, "close")
                    : createNullHandle();
            }
            return createNullHandle();
        },
        async waitForFunction(callback) {
            if (
                callback.name === "waitForProfileTriggerInBrowser"
                && !state.triggerAvailable
            ) {
                throw new Error("trigger timeout");
            }
            if (
                callback.name === "waitForInfoDialogInBrowser"
                && !state.dialogVisible
            ) {
                throw new Error("dialog timeout");
            }
            if (
                callback.name === "waitForInfoDialogClosedInBrowser"
                && state.dialogVisible
            ) {
                throw new Error("close timeout");
            }
            return { async dispose() {} };
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                if (state.currentTarget === "trigger") {
                    state.triggerClicks += 1;
                    state.dialogVisible = state.dialogOpens;
                } else if (state.currentTarget === "close") {
                    state.closeClicks += 1;
                    if (!state.closeFails) state.dialogVisible = false;
                }
            },
        },
    };
}


function createLogger(entries) {
    return {
        child() { return this; },
        debug(event, message, fields) {
            entries.push({ level: "debug", event, message, fields });
        },
        info(event, message, fields) {
            entries.push({ level: "info", event, message, fields });
        },
        warn(event, message, fields) {
            entries.push({ level: "warn", event, message, fields });
        },
        error(event, message, fields) {
            entries.push({ level: "error", event, message, fields });
        },
    };
}


const parsed = parseFacebookJoinedDate(
    "  Joined Facebook:   December 11, 2025  "
);
assert.deepEqual(parsed, {
    rawText: "Joined Facebook: December 11, 2025",
    dateText: "December 11, 2025",
    isoDate: "2025-12-11",
    year: 2025,
    month: 12,
    day: 11,
    precision: "day",
});
assert.equal(
    parseFacebookJoinedDate("October 1, 1981"),
    null,
    "Дата народження не повинна вважатися датою створення профілю"
);
assert.equal(
    parseFacebookJoinedDate("Joined Facebook: February 30, 2025"),
    null
);

const timingOptions = {
    timeout: 100,
    random: () => 0,
    sleep: async () => {},
};
const logEntries = [];
const page = createMockPage();
const result = await getFacebookPersonalProfileCreationDate(page, {
    ...timingOptions,
    logger: createLogger(logEntries),
});

assert.equal(result.success, true, JSON.stringify(result));
assert.equal(result.status, facebookPersonalProfileCreationDateStatuses.FOUND);
assert.equal(result.profileName, "Adi Chandra");
assert.equal(result.source, "profile_info_dialog");
assert.equal(result.isoDate, "2025-12-11");
assert.equal(result.year, 2025);
assert.equal(result.month, 12);
assert.equal(result.day, 11);
assert.equal(result.dialogOpened, true);
assert.equal(result.dialogClosed, true);
assert.equal(page.state.triggerClicks, 1);
assert.equal(page.state.closeClicks, 1);
assert.equal(page.state.dialogVisible, false);
assert.ok(logEntries.some((entry) =>
    entry.event === "facebook.profile_creation_date.selector.search"
));
assert.ok(logEntries.some((entry) =>
    entry.event === "facebook.profile_creation_date.selector.found"
));

const existingPage = createMockPage({
    existingText: "Joined Facebook: January 2, 2024",
});
const existingResult = await getFacebookPersonalProfileCreationDate(
    existingPage,
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(existingResult.success, true);
assert.equal(existingResult.source, "existing_dom");
assert.equal(existingResult.isoDate, "2024-01-02");
assert.equal(existingResult.dialogOpened, false);
assert.equal(existingResult.dialogClosed, false);
assert.equal(existingPage.state.triggerClicks, 0);
assert.equal(existingPage.state.closeClicks, 0);

const nameMissing = await getFacebookPersonalProfileCreationDate(
    createMockPage({ profileName: null }),
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(
    nameMissing.status,
    facebookPersonalProfileCreationDateStatuses.PROFILE_NAME_NOT_FOUND
);

const triggerMissing = await getFacebookPersonalProfileCreationDate(
    createMockPage({ triggerAvailable: false }),
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(
    triggerMissing.status,
    facebookPersonalProfileCreationDateStatuses.TRIGGER_NOT_FOUND
);

const dialogMissingPage = createMockPage({ dialogOpens: false });
const dialogMissing = await getFacebookPersonalProfileCreationDate(
    dialogMissingPage,
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(
    dialogMissing.status,
    facebookPersonalProfileCreationDateStatuses.DIALOG_NOT_OPENED
);
assert.equal(dialogMissingPage.state.closeClicks, 0);

const dateMissingPage = createMockPage({ dialogText: null });
const dateMissing = await getFacebookPersonalProfileCreationDate(
    dateMissingPage,
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(
    dateMissing.status,
    facebookPersonalProfileCreationDateStatuses.DATE_NOT_FOUND
);
assert.equal(dateMissing.dialogClosed, true);
assert.equal(dateMissingPage.state.dialogVisible, false);

const invalidDatePage = createMockPage({
    dialogText: "Joined Facebook: February 30, 2025",
});
const invalidDate = await getFacebookPersonalProfileCreationDate(
    invalidDatePage,
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(
    invalidDate.status,
    facebookPersonalProfileCreationDateStatuses.INVALID_DATE
);
assert.equal(invalidDate.dialogClosed, true);

const cleanupFailedPage = createMockPage({ closeFails: true });
const cleanupFailed = await getFacebookPersonalProfileCreationDate(
    cleanupFailedPage,
    { ...timingOptions, logger: createLogger([]) }
);
assert.equal(
    cleanupFailed.status,
    facebookPersonalProfileCreationDateStatuses.CLEANUP_FAILED
);
assert.equal(cleanupFailed.isoDate, "2025-12-11");
assert.equal(cleanupFailed.dialogClosed, false);

for (const selector of [
    personalProfileTimelineLinkSelector,
    personalProfileHeaderActionSelector,
    personalProfileInformationCloseButtonSelector,
]) {
    assert.match(selector, / i\]/, `selector is not case-insensitive: ${selector}`);
}
assert.ok(personalProfileNameButtonCandidatesSelector.includes('[role="button"]'));
assert.ok(personalProfileInformationDialogSelector.includes('[aria-modal="true"]'));

console.log("getFacebookPersonalProfileCreationDate contract tests passed");
