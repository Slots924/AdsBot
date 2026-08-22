import assert from "node:assert/strict";

import changeFacebookName, {
    facebookNameChangeSelectors,
    facebookNameChangeStatuses,
} from "../facebook/actions/changeFacebookName.js";


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
    error(event, message, fields) {
        structuredEntries.push({ level: "error", event, message, fields });
    },
};

const invalidResult = await changeFacebookName(page, {
    firstName: "",
    lastName: "Sedláček",
    logger: structuredLogger,
});

assert.equal(invalidResult.success, false);
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
assert.match(consoleEntries[0].message, /changeFacebookName/);
assert.equal(consoleEntries[0].fields.stage, "VALIDATE_INPUT");

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
    'a[role="link"][aria-label="Name"]'
);

console.log("changeFacebookName contract tests passed");
