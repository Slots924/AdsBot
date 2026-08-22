import assert from "node:assert/strict";

import openFacebookUserProfile, {
    buildFacebookUserProfileUrl,
} from "../facebook/actions/openFacebookUserProfile.js";


const profileId = "61580943626857";
const expectedUrl =
    `https://www.facebook.com/profile.php?id=${profileId}`;

assert.equal(buildFacebookUserProfileUrl(profileId), expectedUrl);
assert.equal(
    buildFacebookUserProfileUrl(`  ${profileId}  `),
    expectedUrl
);
assert.throws(() => buildFacebookUserProfileUrl(""), TypeError);
assert.throws(() => buildFacebookUserProfileUrl("123abc"), TypeError);
assert.throws(() => buildFacebookUserProfileUrl(61580943626857), TypeError);

const events = [];
const page = {
    evaluateOnNewDocument: async () => {
        events.push("evaluateOnNewDocument");
    },
    goto: async (url, options) => {
        events.push(["goto", url, options]);
    },
    waitForFunction: async (_callback, options) => {
        events.push(["waitForFunction", options]);
    },
};
const delays = [];

assert.equal(await openFacebookUserProfile(page, profileId, {
    timeout: 43210,
    random: () => 0,
    sleep: async (milliseconds) => delays.push(milliseconds),
}), true);
assert.deepEqual(events, [
    "evaluateOnNewDocument",
    [
        "goto",
        expectedUrl,
        {
            waitUntil: "domcontentloaded",
            timeout: 43210,
        },
    ],
    ["waitForFunction", { timeout: 43210 }],
]);
assert.deepEqual(delays, [3000]);

let invalidIdNavigationStarted = false;
const invalidPage = {
    evaluateOnNewDocument: async () => {
        invalidIdNavigationStarted = true;
    },
};
const originalConsoleError = console.error;
console.error = () => {};

try {
    assert.equal(
        await openFacebookUserProfile(invalidPage, "invalid"),
        false
    );
} finally {
    console.error = originalConsoleError;
}

assert.equal(invalidIdNavigationStarted, false);

console.log("openFacebookUserProfile contract tests passed");
