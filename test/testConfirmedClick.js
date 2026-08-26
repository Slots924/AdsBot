import assert from "node:assert/strict";

import {
    ConfirmedClickError,
    clickUntilConfirmed,
    clickWhenStable,
    describeLocator,
    matchesLocatorText,
    waitForDomQuiet,
} from "../facebook/browser/confirmedClick.js";


assert.equal(
    matchesLocatorText("Review change", "review change"),
    true
);
assert.equal(
    matchesLocatorText("  DONE  ", "Done"),
    true
);
assert.equal(
    matchesLocatorText("Review change", "Done"),
    false
);

assert.equal(
    describeLocator({
        selector: '[aria-label="Name" i]',
        index: 0,
    }),
    '[aria-label="Name" i][0]'
);
assert.equal(
    describeLocator({
        candidateSelector: "span",
        expectedText: "Review change",
        closestSelector: '[role="button"]',
    }),
    'span text="Review change" -> closest([role="button"])'
);
assert.equal(
    describeLocator({
        candidateSelector: '[role="button"]',
        expectedText: "Done",
    }),
    '[role="button"] text="Done"'
);

await assert.rejects(
    () => clickWhenStable({}, { target: {} }),
    TypeError
);
await assert.rejects(
    () => clickUntilConfirmed({}, {
        target: { selector: ".name" },
        confirm: { selector: ".form" },
        attempts: 0,
    }),
    RangeError
);


function createHandle(element) {
    return {
        asElement: () => element,
        dispose: async () => {},
    };
}


function createClickablePage({
    confirmSelector = ".confirm",
    isConfirmVisible = () => false,
} = {}) {
    const clicks = [];
    const targetElement = {
        evaluate: async () => {},
        boundingBox: async () => ({
            x: 100,
            y: 200,
            width: 200,
            height: 40,
        }),
        dispose: async () => {},
    };
    const confirmElement = {
        ...targetElement,
    };
    const page = {
        clicks,
        waitForFunction: async (_fn, _options, selector, index) => {
            const target = typeof selector === "string"
                ? selector
                : selector?.selector;

            if (target === confirmSelector && !isConfirmVisible()) {
                throw new Error("timeout");
            }

            if (
                typeof selector === "object"
                && selector?.expectedText
                && !isConfirmVisible()
                && selector.expectedText.toLowerCase() === "done"
                && selector.candidateSelector.includes("button")
            ) {
                throw new Error("timeout");
            }

            return { dispose: async () => {} };
        },
        evaluateHandle: async (_fn, selector, index) => {
            const target = typeof selector === "string"
                ? selector
                : selector?.selector ?? selector?.expectedText;

            if (
                target === confirmSelector
                || String(target).toLowerCase() === "done"
            ) {
                return isConfirmVisible()
                    ? createHandle(confirmElement)
                    : {
                        asElement: () => null,
                        dispose: async () => {},
                    };
            }

            return createHandle(targetElement);
        },
        evaluate: async (fn) => {
            if (fn && fn.name === "waitForDomQuietInPage") {
                return true;
            }

            return { width: 1280, height: 900 };
        },
        mouse: {
            move: async () => {},
            down: async () => {
                clicks.push("down");
            },
            up: async () => {
                clicks.push("up");
            },
        },
    };

    return page;
}


const stablePage = createClickablePage();
await clickWhenStable(stablePage, {
    target: { selector: ".name" },
    description: "Name",
    clickOptions: {
        random: () => 0.5,
        sleep: async () => {},
    },
});
assert.deepEqual(stablePage.clicks, ["down", "up"]);

const quietCalls = [];
const quietPage = {
    evaluate: async (_fn, locator, quietMs, timeout) => {
        quietCalls.push({ locator, quietMs, timeout });
        return true;
    },
};
assert.equal(
    await waitForDomQuiet(quietPage, { selector: ".name", index: 0 }, {
        quietMs: 300,
        timeout: 5000,
    }),
    true
);
assert.deepEqual(quietCalls[0], {
    locator: {
        type: "selector",
        selector: ".name",
        index: 0,
    },
    quietMs: 300,
    timeout: 5000,
});

let confirmAfterClicks = 0;
const retryPage = createClickablePage({
    isConfirmVisible: () => confirmAfterClicks >= 2,
});
const originalDown = retryPage.mouse.down;
retryPage.mouse.down = async () => {
    confirmAfterClicks += 1;
    await originalDown();
};
const retryResult = await clickUntilConfirmed(retryPage, {
    target: { selector: ".name", index: 0 },
    confirm: { selector: ".confirm" },
    description: "Name",
    confirmTimeout: 15,
    clickOptions: {
        random: () => 0.5,
        sleep: async () => {},
    },
});
assert.equal(retryResult.clicked, true);
assert.equal(retryResult.attempt, 2);
assert.equal(confirmAfterClicks, 2);

const alreadyPage = createClickablePage({
    isConfirmVisible: () => true,
});
const alreadyResult = await clickUntilConfirmed(alreadyPage, {
    target: { selector: ".name" },
    confirm: { selector: ".confirm" },
    description: "Name",
    clickOptions: {
        random: () => 0.5,
        sleep: async () => {},
    },
});
assert.equal(alreadyResult.clicked, false);
assert.equal(alreadyResult.attempt, 1);
assert.deepEqual(alreadyPage.clicks, []);

const failedPage = createClickablePage();
await assert.rejects(
    () => clickUntilConfirmed(failedPage, {
        target: { selector: ".name" },
        confirm: { selector: ".confirm" },
        description: "Name",
        confirmTimeout: 15,
        clickOptions: {
            random: () => 0.5,
            sleep: async () => {},
        },
    }),
    (error) => {
        assert.ok(error instanceof ConfirmedClickError);
        assert.equal(error.code, "BROWSER_CLICK_NOT_CONFIRMED");
        assert.equal(error.attempt, 3);
        assert.equal(failedPage.clicks.length, 6);
        return true;
    }
);

const reviewPage = createClickablePage({
    isConfirmVisible: () => reviewPage.clicks.length > 0,
});
const reviewResult = await clickUntilConfirmed(reviewPage, {
    target: {
        candidateSelector: "span",
        expectedText: "review change",
        closestSelector: '[role="button"]',
    },
    confirm: {
        candidateSelector: '[role="button"]',
        expectedText: "DONE",
    },
    description: "Review change",
    confirmTimeout: 15,
    clickOptions: {
        random: () => 0.5,
        sleep: async () => {},
    },
});
assert.equal(reviewResult.clicked, true);
assert.equal(reviewPage.clicks.length, 2);

console.log("confirmedClick tests passed");
