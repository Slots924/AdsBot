import assert from "node:assert/strict";

import changeFacebookName, {
    findNameInputInPage,
    facebookNameChangeSelectors,
    facebookNameChangeStatuses,
} from "../facebook/actions/changeFacebookName.js";
import { facebookTranslations } from "../facebook/i18n/index.js";


const page = {
    url() {
        return "https://accountscenter.facebook.com/profiles";
    },
};

const structuredEntries = [];
const structuredLogger = {
    child() {
        return this;
    },
    info(event, message, fields) {
        structuredEntries.push({ level: "info", event, message, fields });
    },
    warn(event, message, fields) {
        structuredEntries.push({ level: "warn", event, message, fields });
    },
    debug(event, message, fields, options) {
        structuredEntries.push({ level: "debug", event, message, fields, options });
    },
    error(event, message, fields, options) {
        structuredEntries.push({ level: "error", event, message, fields, options });
    },
};

const invalidResult = await changeFacebookName(page, {
    firstName: "",
    lastName: "Sedláček",
    logger: structuredLogger,
});

assert.equal(invalidResult.success, false);
assert.equal(
    facebookNameChangeStatuses.NAME_BUTTON_FAILED,
    "NAME_BUTTON_FAILED"
);
assert.equal(invalidResult.status, facebookNameChangeStatuses.ERROR);
assert.equal(invalidResult.stage, "VALIDATE_INPUT");
assert.equal(invalidResult.error.code, "FACEBOOK_NAME_INVALID_INPUT");
assert.equal(invalidResult.error.stage, "VALIDATE_INPUT");
assert.equal(invalidResult.error.url, page.url());
assert.equal(invalidResult.failedSelector, null);
assert.ok(Array.isArray(invalidResult.diagnostics));
assert.equal(
    structuredEntries.at(-1).event,
    "facebook.name_change.completed"
);
assert.equal(structuredEntries.at(-1).fields.stage, "VALIDATE_INPUT");
assert.equal(structuredEntries.at(-1).fields.error.code,
    "FACEBOOK_NAME_INVALID_INPUT");

const consoleEntries = [];
await changeFacebookName(page, {
    firstName: "",
    lastName: "Sedláček",
    logger: {
        error(message, fields) {
            consoleEntries.push({ message, fields });
        },
    },
});
assert.equal(consoleEntries.length, 1);
assert.match(consoleEntries[0].message, /Не вдалося змінити ім’я та прізвище: Ім’я та прізвище не можуть бути порожніми/);
assert.equal(consoleEntries[0].fields, undefined);
assert.equal(structuredEntries.at(-1).options.userVisible, true);

// Технічні кроки не засмічують консоль; причина помилки залишається у фінальному рядку.
const failedLogs = [];
const failedPage = {
    ...page,
    async goto() { throw new Error("Navigation timeout"); },
    async evaluate() { return []; },
};
const failedResult = await changeFacebookName(failedPage, {
    firstName: "Test", lastName: "Example",
    logger: {
        info: (...args) => failedLogs.push(args),
        debug: (...args) => failedLogs.push(args),
        error: (...args) => failedLogs.push(args),
    },
});
assert.equal(failedResult.success, false);
assert.deepEqual(failedLogs, [["Не вдалося змінити ім’я та прізвище: Navigation timeout"]]);
assert(failedResult.diagnostics.some((entry) => entry.level === "debug"));

await changeFacebookName(failedPage, {
    firstName: "Test", lastName: "Example", logger: structuredLogger,
});
assert(structuredEntries.some((entry) => entry.level === "debug"
    && entry.options.userVisible === false));
assert.equal(structuredEntries.at(-1).options.userVisible, true);

// Перевіряємо зв’язок label.control без прив’язки до динамічних ID чи порядку полів.
const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
const input = (overrides = {}) => ({
    tagName: "INPUT", type: "text", isConnected: true,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
    ...overrides,
});
const first = input();
const middle = input();
const surname = input();
let surnameLabel = "  sUrNaMe  ";
let hidden = false;
const labels = [
    { textContent: "First name", control: first },
    { textContent: "Middle name", control: middle },
    { get textContent() { return surnameLabel; }, control: surname },
];
const dialog = input({
    getBoundingClientRect: () => ({ width: hidden ? 0 : 100, height: 30 }),
    querySelectorAll: () => labels,
    contains: (element) => [first, middle, surname].includes(element),
});
try {
    globalThis.window = { getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
    globalThis.document = { querySelectorAll: (selector) => {
        assert.equal(selector, facebookNameChangeSelectors.anyNameDialog);
        return [input({ getBoundingClientRect: () => ({ width: 0, height: 0 }) }), dialog];
    } };
    const findSurname = () => findNameInputInPage(
        facebookNameChangeSelectors.anyNameDialog, facebookTranslations.en.nameChange.lastName
    );
    assert.equal(findSurname(), surname);
    surnameLabel = " LAST   NAME ";
    assert.equal(findSurname(), surname);
    assert.equal(findNameInputInPage(facebookNameChangeSelectors.anyNameDialog,
        facebookTranslations.en.nameChange.firstName), first);
    surnameLabel = "Middle name";
    assert.equal(findSurname(), null);
    surnameLabel = "Surname";
    hidden = true;
    assert.equal(findSurname(), null);
    hidden = false;
    for (const property of ["disabled", "readOnly"]) {
        surname[property] = true;
        assert.equal(findSurname(), null);
        surname[property] = false;
    }
    surname.isConnected = false;
    assert.equal(findSurname(), null);
    surname.isConnected = true;
    surname.closest = () => ({});
    assert.equal(findSurname(), null);
    surname.closest = () => null;
    dialog.contains = () => false;
    assert.equal(findSurname(), null);
} finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
}

await assert.doesNotReject(() => changeFacebookName(page, {
    firstName: "",
    lastName: "Sedláček",
    logger: {
        child() {
            return this;
        },
        error() {
            throw new Error("Logger unavailable");
        },
    },
}));

assert.equal(
    facebookNameChangeSelectors.accountOverview,
    'a[href*="account_overview"]'
);
assert.equal(
    facebookNameChangeSelectors.accountOverviewDialogLink,
    'div[role="dialog"][aria-modal="true"] '
        + 'a[role="link"][href*="entrypoint=account_overview"]'
);
assert.equal(
    facebookNameChangeSelectors.nameLink,
    '[role="dialog"][aria-modal="true"] [aria-label="Name" i]'
);

console.log("changeFacebookName contract tests passed");
