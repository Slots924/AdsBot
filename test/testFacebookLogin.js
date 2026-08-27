import assert from "node:assert/strict";

import detectLoginStatus from "../facebook/state/detectLoginStatus.js";
import ensureLogin from "../facebook/state/ensureLogin.js";
import fillLoginCredentials from "../facebook/state/fillLoginCredentials.js";
import login from "../facebook/state/login.js";
import {
    createNewAccountSelector,
    logInButtonSelector,
    useAnotherProfileSelector,
} from "../facebook/selectors/login.js";


function selectorHasCaseInsensitiveAriaLabel(selector, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
        `\\[aria-label="${escaped}" i\\]`,
        "i"
    ).test(selector);
}


assert.equal(
    selectorHasCaseInsensitiveAriaLabel(
        createNewAccountSelector,
        "Create new account"
    ),
    true
);
assert.equal(
    selectorHasCaseInsensitiveAriaLabel(
        createNewAccountSelector,
        "CREATE NEW ACCOUNT"
    ),
    true
);
assert.equal(
    selectorHasCaseInsensitiveAriaLabel(
        useAnotherProfileSelector,
        "USE ANOTHER PROFILE"
    ),
    true
);
assert.equal(
    selectorHasCaseInsensitiveAriaLabel(
        logInButtonSelector,
        "log in"
    ),
    true
);

const delays = [];
await fillLoginCredentials({}, {
    sleep: async (milliseconds) => delays.push(milliseconds),
});
assert.deepEqual(delays, [10000]);

const loggedInPage = {
    evaluate: async () => false,
};
assert.equal(await detectLoginStatus(loggedInPage), "LOGGED_IN");

const loggedOutPage = {
    evaluate: async (_fn, selector) => selector === createNewAccountSelector,
};
assert.equal(await detectLoginStatus(loggedOutPage), "LOGGED_OUT");

const alreadyLoggedInEvents = [];
const alreadyLoggedInPage = {
    evaluate: async () => false,
    waitForFunction: async () => {
        alreadyLoggedInEvents.push("waitForFunction");
        return { dispose: async () => {} };
    },
};
assert.equal(await ensureLogin(alreadyLoggedInPage), true);
assert.deepEqual(alreadyLoggedInEvents, []);


function createLoginPage({ hasUseAnotherProfile }) {
    const events = [];
    let lastSelector = null;
    let submitted = false;

    const createElement = () => ({
        dispose: async () => {},
        evaluate: async () => {},
        boundingBox: async () => ({
            x: 100,
            y: 200,
            width: 200,
            height: 100,
        }),
    });

    return {
        events,
        evaluate: async (fn, ...args) => {
            if (args.length === 1) {
                const selector = args[0];
                if (selector === createNewAccountSelector) {
                    return !submitted;
                }
                if (selector === useAnotherProfileSelector) {
                    return hasUseAnotherProfile && !submitted;
                }
            }

            return { width: 1280, height: 900 };
        },
        waitForFunction: async (_fn, _options, ...args) => {
            events.push(["waitForFunction", ...args]);
            return { dispose: async () => {} };
        },
        evaluateHandle: async (_fn, selector) => {
            lastSelector = selector;
            events.push(["handle", selector]);
            const element = createElement();
            return {
                asElement: () => element,
                dispose: async () => {},
            };
        },
        mouse: {
            move: async () => {},
            down: async () => {
                events.push(["click", lastSelector]);
                if (lastSelector === logInButtonSelector) {
                    submitted = true;
                }
            },
            up: async () => {},
        },
    };
}


const timing = {
    timeout: 12345,
    random: () => 0.5,
    sleep: async () => {},
};

const variantWithAccounts = createLoginPage({
    hasUseAnotherProfile: true,
});
assert.equal(await login(variantWithAccounts, timing), true);
assert.equal(
    variantWithAccounts.events.some((event) =>
        Array.isArray(event)
        && event[0] === "click"
        && event[1] === useAnotherProfileSelector
    ),
    true
);
assert.equal(
    variantWithAccounts.events.some((event) =>
        Array.isArray(event)
        && event[0] === "click"
        && event[1] === logInButtonSelector
    ),
    true
);
assert.deepEqual(
    variantWithAccounts.events.find((event) =>
        Array.isArray(event)
        && event[0] === "waitForFunction"
        && event.length === 3
    ),
    ["waitForFunction", useAnotherProfileSelector, logInButtonSelector]
);

const variantDirectLogin = createLoginPage({
    hasUseAnotherProfile: false,
});
assert.equal(await login(variantDirectLogin, timing), true);
assert.equal(
    variantDirectLogin.events.some((event) =>
        Array.isArray(event)
        && event[0] === "click"
        && event[1] === useAnotherProfileSelector
    ),
    false
);
assert.equal(
    variantDirectLogin.events.some((event) =>
        Array.isArray(event)
        && event[0] === "click"
        && event[1] === logInButtonSelector
    ),
    true
);

const ensureLoggedOutPage = createLoginPage({
    hasUseAnotherProfile: false,
});
assert.equal(await ensureLogin(ensureLoggedOutPage, timing), true);
assert.equal(
    ensureLoggedOutPage.events.some((event) =>
        Array.isArray(event)
        && event[0] === "click"
        && event[1] === logInButtonSelector
    ),
    true
);

console.log("Facebook login tests passed");
