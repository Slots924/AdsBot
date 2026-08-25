import assert from "node:assert/strict";

import fillFacebookPersonalProfileAbout, {
    facebookPersonalProfileAboutFieldStatuses,
    facebookPersonalProfileAboutSkipReasons,
    facebookPersonalProfileAboutStatuses,
    normalizeFacebookPersonalProfileAboutFields,
} from "../facebook/actions/fillFacebookPersonalProfileAbout.js";
import {
    personalProfileAboutEditBioButtonSelector,
    personalProfileAboutEditWorkplaceButtonSelector,
    personalProfileAboutLeavePageDialogSelector,
    personalProfileAboutSelectors,
} from "../facebook/selectors/personalProfileAbout.js";


function ariaLabelSelectorMatches(selector, actualLabel) {
    const match = String(selector).match(/\[aria-label="([^"]+)" i\]/i);
    if (!match) return false;
    return String(actualLabel ?? "").trim().toLocaleLowerCase()
        === match[1].trim().toLocaleLowerCase();
}


const emptyNormalized = normalizeFacebookPersonalProfileAboutFields({
    extra: "ignore-me",
    bio: "  ",
    work: { company: "Acme" },
    education: 12,
});

assert.equal(emptyNormalized.bio, null);
assert.equal(emptyNormalized.bioRequested, true);
assert.equal(emptyNormalized.workRequested, false);
assert.equal(
    emptyNormalized.workSkipReason,
    facebookPersonalProfileAboutSkipReasons.INCOMPLETE_WORK
);
assert.equal(emptyNormalized.educationRequested, false);
assert.equal(
    emptyNormalized.educationSkipReason,
    facebookPersonalProfileAboutSkipReasons.MISSING_INPUT
);
assert.equal("extra" in emptyNormalized, false);

const fullNormalized = normalizeFacebookPersonalProfileAboutFields({
    bio: "I hike on weekends",
    work: { company: "Acme", position: "Engineer" },
    education: "Harvard University",
});
assert.deepEqual(fullNormalized.work, {
    company: "Acme",
    position: "Engineer",
});
assert.equal(fullNormalized.education, "Harvard University");
assert.equal(fullNormalized.workRequested, true);
assert.equal(fullNormalized.educationRequested, true);

assert.equal(
    normalizeFacebookPersonalProfileAboutFields(null),
    null
);
assert.ok(normalizeFacebookPersonalProfileAboutFields({}));

assert.equal(
    ariaLabelSelectorMatches(
        personalProfileAboutEditBioButtonSelector,
        "Edit Bio"
    ),
    true
);
assert.equal(
    ariaLabelSelectorMatches(
        personalProfileAboutEditWorkplaceButtonSelector,
        "EDIT WORKPLACE"
    ),
    true
);
assert.equal(
    ariaLabelSelectorMatches(
        personalProfileAboutLeavePageDialogSelector,
        "Leave page?"
    ),
    true
);

const timingOptions = {
    random: () => 0,
    sleep: async () => {},
};
const silentLogger = {
    info() {},
    warn() {},
    error() {},
};


function createAboutPage({
    hasEditBio = false,
    bioValue = "",
    workExists = false,
    collegeExists = false,
    leavePageOnSideTab = false,
    invalidNameOnCollegeSave = false,
    invalidNameOnWorkSave = false,
    invalidNameIfLongerThan = 0,
    comboboxOptions = null,
    comboboxAfterBackspaces = 0,
} = {}) {
    const state = {
        aboutOpen: false,
        tab: "intro",
        pendingTab: null,
        bioValue,
        hasEditBio,
        bioEditing: false,
        workExists,
        workCompany: workExists ? "Old Co" : "",
        workPosition: workExists ? "Old Role" : "",
        workEditing: false,
        collegeExists,
        collegeName: collegeExists ? "Old College" : "",
        collegeEditing: false,
        leavePage: false,
        invalidName: false,
        saveActive: false,
        comboboxReady: false,
        comboboxOptions: comboboxOptions ?? [],
        focused: null,
        typed: "",
        selectAll: false,
        controlDown: false,
        backspaces: 0,
        leavePageClicks: 0,
        invalidNameCloses: 0,
        currentTarget: null,
    };

    const isTabSelector = (selector) => [
        personalProfileAboutSelectors.aboutTab,
        personalProfileAboutSelectors.introTab,
        personalProfileAboutSelectors.workTab,
        personalProfileAboutSelectors.educationTab,
    ].includes(selector);

    const selectorVisible = (selector) => {
        if (selector === personalProfileAboutSelectors.aboutTab) return true;
        if (!state.aboutOpen) return false;
        return isTabSelector(selector);
    };

    const snapshotFor = (title) => {
        const name = String(title ?? "").toLocaleLowerCase();
        if (name === "bio") {
            return {
                found: true,
                text: state.hasEditBio ? `Bio ${state.bioValue}` : "Bio About you",
                hasEditBio: state.hasEditBio,
                hasAboutYou: !state.hasEditBio,
                hasEditWorkplace: false,
                hasEditCollege: false,
                hasTextarea: state.bioEditing,
                hasSave: state.bioEditing,
                saveActive: state.bioEditing && state.saveActive,
                hasCompany: false,
                hasPosition: false,
                hasCollegeName: false,
            };
        }
        if (name === "work") {
            return {
                found: state.aboutOpen,
                text: `${state.workCompany} ${state.workPosition}`.trim(),
                hasEditBio: false,
                hasAboutYou: false,
                hasEditWorkplace: state.workExists,
                hasWorkExperience: !state.workExists,
                hasEditCollege: false,
                hasTextarea: false,
                hasSave: state.workEditing,
                saveActive: state.workEditing && state.saveActive,
                hasCompany: state.workEditing,
                hasPosition: state.workEditing,
                hasCollegeName: false,
            };
        }
        if (name === "college") {
            return {
                found: state.aboutOpen,
                text: state.collegeName,
                hasEditBio: false,
                hasAboutYou: false,
                hasEditWorkplace: false,
                hasEditCollege: state.collegeExists,
                hasTextarea: false,
                hasSave: state.collegeEditing,
                saveActive: state.collegeEditing && state.saveActive,
                hasCompany: false,
                hasPosition: false,
                hasCollegeName: state.collegeEditing,
            };
        }
        return { found: false };
    };

    const resolveQuery = (query) => {
        if (!query || typeof query !== "object") return null;
        if (query.kind === "aboutPanel") return state.aboutOpen;
        if (query.kind === "sectionSnapshot") {
            const snap = snapshotFor(query.title);
            if (query.expectEditor) {
                return snap.found && (
                    snap.hasTextarea
                    || snap.hasCompany
                    || snap.hasCollegeName
                ) ? snap : false;
            }
            if (query.expectFound !== false) return snap.found ? snap : false;
            return snap;
        }
        if (query.kind === "leavePageDialog") {
            if (query.expectAbsent) return !state.leavePage;
            return { found: state.leavePage, unsaved: state.leavePage };
        }
        if (query.kind === "invalidNameDialog") {
            if (query.expectAbsent) return !state.invalidName;
            return { found: state.invalidName };
        }
        if (query.kind === "comboboxOptions") {
            if (query.expectReady) return state.comboboxReady;
            return {
                found: true,
                expanded: state.comboboxReady,
                options: state.comboboxOptions,
            };
        }
        if (query.kind === "inputValue") {
            const selector = String(query.inputSelector ?? "");
            if (selector.includes("Company")) return state.workCompany;
            if (selector.includes("Position")) return state.workPosition;
            if (selector.includes("College")) return state.collegeName;
            return state.typed;
        }
        if (query.kind === "bioOutcome") {
            return !state.bioEditing;
        }
        if (query.kind === "workOutcome") {
            return !state.workEditing;
        }
        if (query.kind === "workSaveOutcome") {
            if (state.invalidName) return { invalidName: true, saved: false };
            if (!state.workEditing && state.workExists) {
                return { invalidName: false, saved: true };
            }
            return false;
        }
        if (query.kind === "collegeSaveOutcome") {
            if (state.invalidName) return { invalidName: true, saved: false };
            if (!state.collegeEditing && state.collegeExists) {
                return { invalidName: false, saved: true };
            }
            return false;
        }
        if (query.kind === "workTabReady") {
            return state.aboutOpen && (state.workExists || !state.workExists);
        }
        if (query.kind === "sectionHeadings") {
            return state.aboutOpen ? ["Work"] : [];
        }
        if (query.kind === "formOpen") {
            return state.bioEditing || state.workEditing || state.collegeEditing;
        }
        if (query.kind === "selector") return selectorVisible(query.selector);
        if (query.kind === "sectionButtonByText") {
            const text = String(query.text ?? "").toLocaleLowerCase();
            if (text === "about you") return !state.hasEditBio;
            if (text === "work experience") return !state.workExists;
            if (text === "college") return !state.collegeExists;
            return false;
        }
        if (query.kind === "sectionButtonByAria") {
            return query.selector === personalProfileAboutSelectors.editBio
                && state.hasEditBio;
        }
        if (query.kind === "sectionField") {
            if (query.field === "bio") return state.bioEditing;
            if (query.field === "company" || query.field === "position") {
                return state.workEditing;
            }
            if (query.field === "college") return state.collegeEditing;
            if (query.field === "save") return state.saveActive;
            return false;
        }
        if (query.kind === "comboboxOption") return state.comboboxReady;
        if (query.kind === "leavePageButton") return state.leavePage;
        if (query.kind === "invalidNameClose") return state.invalidName;
        return null;
    };

    const isReady = (value) => value !== false && value != null;

    const createHandle = (target, available = true, jsonValue = available) => ({
        target,
        asElement() {
            return available ? this : null;
        },
        async dispose() {},
        async jsonValue() {
            return jsonValue;
        },
        async focus() {
            state.focused = target;
        },
        async evaluate(callback) {
            const source = String(callback);
            if (source.includes("scrollIntoView")) return undefined;
            if (source.includes("activeElement")) return true;
            if (source.includes("value")) {
                if (target?.field === "bio") return state.bioValue;
                if (target?.field === "company") return state.workCompany;
                if (target?.field === "position") return state.workPosition;
                if (target?.field === "college") return state.collegeName;
                return "";
            }
            return undefined;
        },
        async boundingBox() {
            state.currentTarget = target;
            return available
                ? { x: 80, y: 120, width: 160, height: 36 }
                : null;
        },
    });

    const applySideTab = (tabName) => {
        if (leavePageOnSideTab && !state.leavePage) {
            state.leavePage = true;
            state.pendingTab = tabName;
            return;
        }
        state.tab = tabName;
    };

    const applyClick = (target) => {
        if (typeof target === "string") {
            if (target === personalProfileAboutSelectors.aboutTab) {
                state.aboutOpen = true;
                return;
            }
            if (target === personalProfileAboutSelectors.introTab) {
                if (state.leavePage) return;
                state.tab = "intro";
                state.bioEditing = false;
                return;
            }
            if (target === personalProfileAboutSelectors.workTab) {
                applySideTab("work");
                return;
            }
            if (target === personalProfileAboutSelectors.educationTab) {
                applySideTab("education");
                return;
            }
        }

        if (!target || typeof target !== "object") return;

        if (target.kind === "leavePageButton") {
            state.leavePageClicks += 1;
            state.leavePage = false;
            if (state.pendingTab) {
                state.tab = state.pendingTab;
                state.pendingTab = null;
            }
            return;
        }
        if (target.kind === "invalidNameClose") {
            state.invalidNameCloses += 1;
            state.invalidName = false;
            return;
        }
        if (target.kind === "sectionButtonByText") {
            const text = String(target.text ?? "").toLocaleLowerCase();
            if (text === "about you") {
                state.bioEditing = true;
                state.saveActive = false;
            }
            if (text === "work experience") {
                state.workEditing = true;
                state.saveActive = false;
            }
            if (text === "college") {
                state.collegeEditing = true;
                state.saveActive = false;
            }
            return;
        }
        if (target.kind === "sectionButtonByAria") {
            state.bioEditing = true;
            state.saveActive = false;
            return;
        }
        if (target.kind === "comboboxOption") {
            state.comboboxReady = false;
            state.saveActive = true;
            return;
        }
        if (target.kind === "sectionField" && target.field === "save") {
            if (target.title === "Bio") {
                state.bioEditing = false;
                state.hasEditBio = Boolean(state.typed || state.bioValue);
                if (state.typed) state.bioValue = state.typed;
                state.saveActive = false;
            }
            if (target.title === "Work") {
                const tooLong = invalidNameIfLongerThan > 0
                    && (
                        state.workCompany.length > invalidNameIfLongerThan
                        || state.workPosition.length > invalidNameIfLongerThan
                    );
                if (
                    invalidNameOnWorkSave
                    && (invalidNameIfLongerThan === 0 || tooLong)
                ) {
                    state.invalidName = true;
                    return;
                }
                state.workEditing = false;
                state.workExists = true;
                state.saveActive = false;
            }
            if (target.title === "College") {
                const tooLong = invalidNameIfLongerThan > 0
                    && state.collegeName.length > invalidNameIfLongerThan;
                if (
                    invalidNameOnCollegeSave
                    && (invalidNameIfLongerThan === 0 || tooLong)
                ) {
                    state.invalidName = true;
                    return;
                }
                state.collegeEditing = false;
                state.collegeExists = true;
                state.collegeName = state.typed || state.collegeName;
                state.saveActive = false;
            }
        }
    };

    return {
        state,
        url() {
            return "https://www.facebook.com/me";
        },
        async evaluate(callback, ...args) {
            if (String(callback).includes("innerWidth")) {
                return { width: 1280, height: 900 };
            }
            return resolveQuery(args[0]);
        },
        async evaluateHandle(callback, ...args) {
            const first = args[0];
            if (typeof first === "string") {
                return createHandle(first, selectorVisible(first));
            }
            const available = Boolean(resolveQuery(first));
            return createHandle(first, available, resolveQuery(first));
        },
        async waitForFunction(callback, _options, ...args) {
            const first = args[0];
            if (typeof first === "string") {
                if (!selectorVisible(first)) {
                    throw new Error(`timeout: ${first}`);
                }
                return createHandle(first);
            }
            const result = resolveQuery(first);
            if (!isReady(result)) {
                throw new Error(`timeout: ${first?.kind ?? "query"}`);
            }
            return createHandle(first, true, result);
        },
        keyboard: {
            async down(key) {
                if (String(key).toLocaleLowerCase() === "control") {
                    state.controlDown = true;
                }
            },
            async up(key) {
                if (String(key).toLocaleLowerCase() === "control") {
                    state.controlDown = false;
                }
            },
            async press(key) {
                if (key === "A" && state.controlDown) {
                    state.selectAll = true;
                    return;
                }
                if (key !== "Backspace") return;
                if (state.selectAll || state.typed === "") {
                    state.typed = "";
                    state.selectAll = false;
                } else {
                    state.typed = state.typed.slice(0, -1);
                    state.backspaces += 1;
                }
                if (state.focused?.field === "bio") state.bioValue = state.typed;
                if (state.focused?.field === "company") {
                    state.workCompany = state.typed;
                }
                if (state.focused?.field === "position") {
                    state.workPosition = state.typed;
                }
                if (state.focused?.field === "college") {
                    state.collegeName = state.typed;
                }
                if (
                    comboboxAfterBackspaces > 0
                    && state.backspaces >= comboboxAfterBackspaces
                    && state.typed
                ) {
                    state.comboboxReady = true;
                    state.comboboxOptions = [state.typed];
                    state.saveActive = true;
                }
            },
            async type(text) {
                state.typed += text;
                state.selectAll = false;
                if (state.focused?.field === "bio") {
                    state.bioValue = state.typed;
                    state.saveActive = true;
                }
                if (state.focused?.field === "company") {
                    state.workCompany = state.typed;
                    if (comboboxAfterBackspaces === 0) {
                        state.comboboxReady = true;
                        state.comboboxOptions = state.comboboxOptions.length > 0
                            ? state.comboboxOptions
                            : [state.typed, `Add “${state.typed}”`];
                    }
                }
                if (state.focused?.field === "position") {
                    state.workPosition = state.typed;
                    state.saveActive = true;
                    if (comboboxAfterBackspaces === 0) {
                        state.comboboxReady = true;
                        state.comboboxOptions = [state.typed];
                    }
                }
                if (state.focused?.field === "college") {
                    state.collegeName = state.typed;
                    if (comboboxAfterBackspaces === 0) {
                        state.comboboxReady = true;
                        state.comboboxOptions = state.comboboxOptions.length > 0
                            ? state.comboboxOptions
                            : [state.typed, `Add “${state.typed}”`];
                    }
                }
            },
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                applyClick(state.currentTarget);
            },
        },
    };
}


const invalidResult = await fillFacebookPersonalProfileAbout(null, {
    fields: { bio: "ok" },
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(invalidResult.success, false);
assert.equal(
    invalidResult.status,
    facebookPersonalProfileAboutStatuses.INVALID_INPUT
);

const emptyFieldsPage = createAboutPage();
const emptyResult = await fillFacebookPersonalProfileAbout(emptyFieldsPage, {
    fields: {},
    timeout: 200,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(emptyResult.status, facebookPersonalProfileAboutStatuses.COMPLETED);
assert.equal(emptyResult.success, true);
assert.equal(
    emptyResult.fields.bio.status,
    facebookPersonalProfileAboutFieldStatuses.CLEARED
);
assert.equal(emptyResult.fields.bio.requested, true);
assert.equal(
    emptyResult.fields.work.status,
    facebookPersonalProfileAboutFieldStatuses.SKIPPED
);
assert.equal(
    emptyResult.fields.work.skipReason,
    facebookPersonalProfileAboutSkipReasons.MISSING_INPUT
);
assert.equal(
    emptyResult.fields.education.status,
    facebookPersonalProfileAboutFieldStatuses.SKIPPED
);

const alreadyPage = createAboutPage({ workExists: true });
const alreadyResult = await fillFacebookPersonalProfileAbout(alreadyPage, {
    fields: {
        work: { company: "Acme", position: "Engineer" },
    },
    timeout: 200,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(alreadyResult.success, true);
assert.equal(
    alreadyResult.fields.work.status,
    facebookPersonalProfileAboutFieldStatuses.SKIPPED
);
assert.equal(
    alreadyResult.fields.work.skipReason,
    facebookPersonalProfileAboutSkipReasons.ALREADY_EXISTS
);

const invalidNamePage = createAboutPage({ invalidNameOnCollegeSave: true });
const invalidNameResult = await fillFacebookPersonalProfileAbout(
    invalidNamePage,
    {
        fields: { education: "Lalaalatat" },
        timeout: 200,
        logger: silentLogger,
        ...timingOptions,
    }
);
assert.equal(invalidNameResult.success, false);
assert.equal(
    invalidNameResult.status,
    facebookPersonalProfileAboutStatuses.PARTIAL
);
assert.equal(
    invalidNameResult.fields.education.status,
    facebookPersonalProfileAboutFieldStatuses.FAILED
);
assert.equal(
    invalidNameResult.fields.bio.status,
    facebookPersonalProfileAboutFieldStatuses.CLEARED
);
assert.ok(invalidNamePage.state.invalidNameCloses >= 1);

const workRetryPage = createAboutPage({
    invalidNameOnWorkSave: true,
    invalidNameIfLongerThan: 4,
});
const workRetryResult = await fillFacebookPersonalProfileAbout(
    workRetryPage,
    {
        fields: {
            work: {
                company: "ABCDEFGH",
                position: "12345678",
            },
        },
        timeout: 200,
        logger: silentLogger,
        ...timingOptions,
    }
);
assert.equal(workRetryResult.success, true);
assert.equal(
    workRetryResult.fields.work.status,
    facebookPersonalProfileAboutFieldStatuses.FILLED
);
assert.ok(workRetryPage.state.invalidNameCloses >= 1);
assert.ok(workRetryPage.state.workCompany.length <= 4);
assert.ok(workRetryPage.state.workPosition.length <= 4);

const trimPage = createAboutPage({ comboboxAfterBackspaces: 2 });
const trimResult = await fillFacebookPersonalProfileAbout(trimPage, {
    fields: { education: "Harvard University" },
    timeout: 200,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(trimResult.success, true);
assert.equal(
    trimResult.fields.education.status,
    facebookPersonalProfileAboutFieldStatuses.FILLED
);
assert.ok(trimPage.state.backspaces >= 2);

const leavePage = createAboutPage({
    leavePageOnSideTab: true,
    collegeExists: true,
});
const leaveResult = await fillFacebookPersonalProfileAbout(leavePage, {
    fields: { education: "Harvard University" },
    timeout: 200,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(leaveResult.success, false);
assert.equal(
    leaveResult.fields.bio.status,
    facebookPersonalProfileAboutFieldStatuses.FAILED
);
assert.equal(
    leaveResult.fields.education.status,
    facebookPersonalProfileAboutFieldStatuses.SKIPPED
);
assert.equal(
    leaveResult.fields.education.skipReason,
    facebookPersonalProfileAboutSkipReasons.ALREADY_EXISTS
);
assert.ok(leavePage.state.leavePageClicks >= 1);

await assert.doesNotReject(() => fillFacebookPersonalProfileAbout(
    createAboutPage(),
    {
        fields: {},
        timeout: 200,
        logger: {
            child() {
                return this;
            },
            info() {
                throw new Error("Logger unavailable");
            },
            error() {
                throw new Error("Logger unavailable");
            },
        },
        onProgress() {
            throw new Error("Progress unavailable");
        },
        ...timingOptions,
    }
));

console.log("fillFacebookPersonalProfileAbout contract tests passed");
