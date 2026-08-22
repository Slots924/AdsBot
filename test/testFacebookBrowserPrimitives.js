import assert from "node:assert/strict";

import {
    BrowserElementError,
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../facebook/browser/elements.js";
import {
    clickLeftMouse,
    humanClickElement,
    moveMouseToElement,
} from "../facebook/browser/pointer.js";
import {
    humanScrollToElement,
    humanScrollToSelector,
} from "../facebook/browser/scroll.js";
import {
    HUMAN_DELAY_PRESETS,
    randomInteger,
    wait,
    waitHuman,
    waitRandom,
} from "../facebook/browser/timing.js";


assert.equal(randomInteger(10, 20, { random: () => 0 }), 10);
assert.equal(randomInteger(10, 20, { random: () => 0.999 }), 20);
assert.throws(() => randomInteger(20, 10), RangeError);
assert.throws(() => randomInteger(1, 2, { random: () => 1 }), RangeError);

const delays = [];
assert.equal(await wait(125, {
    sleep: async (milliseconds) => delays.push(milliseconds),
}), 125);
assert.equal(await waitRandom(100, 200, {
    random: () => 0.5,
    sleep: async (milliseconds) => delays.push(milliseconds),
}), 150);
assert.equal(await waitHuman("medium", {
    random: () => 0,
    sleep: async (milliseconds) => delays.push(milliseconds),
}), HUMAN_DELAY_PRESETS.medium.minimum);
assert.deepEqual(delays, [125, 150, 1500]);
await assert.rejects(() => waitHuman("unknown", {
    sleep: async () => {},
}), RangeError);

const visibleElement = { dispose: async () => {} };
const visibleHandle = {
    asElement: () => visibleElement,
    dispose: async () => {},
};
const visiblePage = {
    evaluateHandle: async () => visibleHandle,
};
assert.equal(
    await getFirstVisibleElement(visiblePage, ".target"),
    visibleElement
);

let hiddenHandleDisposed = false;
const hiddenPage = {
    evaluateHandle: async () => ({
        asElement: () => null,
        dispose: async () => {
            hiddenHandleDisposed = true;
        },
    }),
};
assert.equal(
    await getFirstVisibleElement(hiddenPage, ".hidden"),
    null
);
assert.equal(hiddenHandleDisposed, true);

let readyDisposed = false;
const waitingPage = {
    waitForFunction: async () => ({
        dispose: async () => {
            readyDisposed = true;
        },
    }),
    evaluateHandle: async () => visibleHandle,
};
assert.equal(
    await waitForVisibleElement(waitingPage, ".target", {
        timeout: 4321,
        index: 2,
    }),
    visibleElement
);
assert.equal(readyDisposed, true);

const timeoutPage = {
    waitForFunction: async () => {
        throw new Error("timeout");
    },
};
await assert.rejects(
    () => waitForVisibleElement(timeoutPage, ".missing", {
        timeout: 987,
    }),
    (error) => {
        assert.ok(error instanceof BrowserElementError);
        assert.equal(error.code, "BROWSER_ELEMENT_TIMEOUT");
        assert.equal(error.selector, ".missing");
        assert.equal(error.timeoutMs, 987);
        return true;
    }
);

const mouseEvents = [];
const telemetry = [];
const pointerSleeps = [];
const pointerPage = {
    evaluate: async () => ({ width: 1280, height: 900 }),
    mouse: {
        move: async (x, y, options) => {
            mouseEvents.push(["move", x, y, options.steps]);
        },
        down: async (options) => mouseEvents.push(["down", options.button]),
        up: async (options) => mouseEvents.push(["up", options.button]),
    },
};
const pointerElement = {
    evaluate: async () => {},
    boundingBox: async () => ({
        x: 100,
        y: 200,
        width: 200,
        height: 100,
    }),
};

const movement = await moveMouseToElement(pointerPage, pointerElement, {
    random: () => 0.5,
    scrollDelay: [10, 20],
    sleep: async (milliseconds) => pointerSleeps.push(milliseconds),
    onEvent: async (event) => telemetry.push(event),
});
assert.equal(movement.x, 200);
assert.equal(movement.y, 250);
assert.equal(movement.steps, 13);
assert.deepEqual(mouseEvents[0], ["move", 200, 250, 13]);
assert.deepEqual(pointerSleeps, [15]);
assert.ok(telemetry.some((event) => event.type === "mouse_move"));

await clickLeftMouse(pointerPage, {
    random: () => 0.5,
    beforeDelay: [20, 40],
    holdDelay: [70, 170],
    sleep: async (milliseconds) => pointerSleeps.push(milliseconds),
});
assert.deepEqual(mouseEvents.slice(-2), [
    ["down", "left"],
    ["up", "left"],
]);
assert.deepEqual(pointerSleeps.slice(-2), [30, 120]);

const clickResult = await humanClickElement(
    pointerPage,
    pointerElement,
    {
        random: () => 0.5,
        scrollIntoView: false,
        holdDelay: [70, 170],
        sleep: async () => {},
    }
);
assert.equal(clickResult.x, 200);
assert.equal(clickResult.holdDelayMs, 120);

let scrollConfig = null;
const scrollElement = {
    dispose: async () => {},
};
const scrollPage = {
    evaluate: async (_callback, _element, config) => {
        scrollConfig = config;
        return {
            container: "window",
            startPosition: 0,
            targetPosition: 250,
        };
    },
};
const scrollResult = await humanScrollToElement(
    scrollPage,
    scrollElement,
    {
        position: "bottom",
        jitterPx: 25,
        durationMs: 900,
        stepRange: [12, 24],
        random: () => 0.25,
    }
);
assert.equal(scrollResult.targetPosition, 250);
assert.deepEqual(scrollConfig, {
    position: "bottom",
    jitterPx: 25,
    durationMs: 900,
    stepRange: [12, 24],
    randomValue: 0.25,
});
await assert.rejects(
    () => humanScrollToElement(scrollPage, scrollElement, {
        position: "sideways",
    }),
    RangeError
);

let scrollElementDisposed = false;
const selectorElement = {
    dispose: async () => {
        scrollElementDisposed = true;
    },
};
const selectorPage = {
    waitForFunction: async () => ({ dispose: async () => {} }),
    evaluateHandle: async () => ({
        asElement: () => selectorElement,
        dispose: async () => {},
    }),
    evaluate: async () => ({
        container: "element",
        startPosition: 5,
        targetPosition: 100,
    }),
};
await humanScrollToSelector(selectorPage, ".scroll-target", {
    index: 1,
    random: () => 0.5,
});
assert.equal(scrollElementDisposed, true);
await assert.rejects(
    () => humanScrollToSelector(selectorPage, ".target", { index: -1 }),
    RangeError
);

console.log("Facebook browser primitives tests passed");
