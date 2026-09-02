import assert from "node:assert/strict";

import configureFacebookAutomationWindow, {
    facebookAutomationWindowSize,
} from "../facebook/browser/configureFacebookAutomationWindow.js";


const headlessCalls = [];
const headlessResult = await configureFacebookAutomationWindow({
    async setViewport(viewport) {
        headlessCalls.push(viewport);
    },
}, { browserMode: "headless" });

assert.equal(headlessResult.applied, true);
assert.equal(headlessResult.mode, "headless");
assert.deepEqual(headlessCalls, [facebookAutomationWindowSize]);

const visibleCalls = [];
const visibleResult = await configureFacebookAutomationWindow({
    target() {
        return {
            async createCDPSession() {
                return {
                    async send(command, params) {
                        visibleCalls.push({ command, params });
                        if (command === "Browser.getWindowForTarget") {
                            return { windowId: 7 };
                        }
                        if (command === "Browser.getWindowBounds") {
                            return {
                                bounds: {
                                    width: facebookAutomationWindowSize.width,
                                    height: facebookAutomationWindowSize.height,
                                },
                            };
                        }
                        return {};
                    },
                    async detach() {},
                };
            },
        };
    },
}, { browserMode: "visible" });

assert.equal(visibleResult.applied, true);
assert.equal(visibleResult.mode, "visible");
assert.equal(visibleCalls[1].params.bounds.windowState, "normal");
assert.deepEqual(visibleCalls[2].params.bounds, {
    width: facebookAutomationWindowSize.width,
    height: facebookAutomationWindowSize.height,
});

console.log("Mock-перевірка розміру браузера для Facebook пройшла успішно");
