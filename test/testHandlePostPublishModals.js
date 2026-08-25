import assert from "node:assert/strict";

import handlePostPublishModals from "../facebook/modals/handlePostPublishModals.js";
import { classifyPostPublishModal } from "../facebook/modals/inspectVisibleModal.js";
import {
    postPublishAudienceSaveButtonSelector,
    postPublishContinueButtonSelector,
    postPublishModalDialogSelector,
    postPublishPublicLabelSelector,
} from "../facebook/selectors/postPublishModals.js";


assert.equal(
    classifyPostPublishModal({ title: "REVIEW AUDIENCE" }),
    "reviewAudience"
);
assert.equal(
    classifyPostPublishModal({
        title: "Who can see your future posts and reels?",
    }),
    "futurePostsAudience"
);
assert.equal(
    classifyPostPublishModal({ ariaLabel: "Create post" }),
    "createPost"
);
assert.equal(
    classifyPostPublishModal({ ariaLabel: "CREATE A POST" }),
    "createPost"
);


function createHandle(state, selector, available = true) {
    return {
        asElement() {
            return available ? this : null;
        },
        async dispose() {},
        async evaluate() {},
        async boundingBox() {
            state.currentSelector = selector;
            return available
                ? { x: 80, y: 90, width: 140, height: 36 }
                : null;
        },
    };
}


function createModalPage() {
    const state = {
        kind: "reviewAudience",
        currentSelector: null,
        continued: 0,
        publicClicks: 0,
        saveClicks: 0,
    };
    const selectorVisible = (selector) => {
        if (selector === postPublishContinueButtonSelector) {
            return state.kind === "reviewAudience";
        }
        if (selector === postPublishPublicLabelSelector) {
            return state.kind === "futurePostsAudience";
        }
        if (selector === postPublishAudienceSaveButtonSelector) {
            return state.kind === "futurePostsAudience";
        }
        return false;
    };

    return {
        state,
        async evaluate(callback, first) {
            if (String(callback).includes("innerWidth")) {
                return { width: 1280, height: 900 };
            }
            if (first?.dialog) {
                if (state.kind === "reviewAudience") {
                    return {
                        createPostVisible: true,
                        found: true,
                        kind: "reviewAudience",
                        title: "Review audience",
                        ariaLabel: "",
                    };
                }
                if (state.kind === "futurePostsAudience") {
                    return {
                        createPostVisible: false,
                        found: true,
                        kind: "futurePostsAudience",
                        title: "Who can see your future posts and reels?",
                        ariaLabel: "",
                    };
                }
                return {
                    createPostVisible: false,
                    found: false,
                    kind: null,
                    title: "",
                    ariaLabel: "",
                };
            }
            return null;
        },
        async evaluateHandle(_callback, ...args) {
            if (
                args[0] === postPublishModalDialogSelector
                && args[1] === postPublishPublicLabelSelector
            ) {
                return createHandle(
                    state,
                    "public-parent",
                    state.kind === "futurePostsAudience"
                );
            }
            const selector = args[0];
            return createHandle(state, selector, selectorVisible(selector));
        },
        async waitForFunction(_callback, _options, ...args) {
            if (
                args[0] === postPublishModalDialogSelector
                && args[2] === "public"
            ) {
                if (state.kind !== "futurePostsAudience") {
                    throw new Error("timeout: Public");
                }
                return createHandle(state, "public-parent");
            }
            const selector = args[0];
            if (!selectorVisible(selector)) {
                throw new Error(`timeout: ${selector}`);
            }
            return createHandle(state, selector);
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                if (state.currentSelector === postPublishContinueButtonSelector) {
                    state.continued += 1;
                    state.kind = "futurePostsAudience";
                } else if (state.currentSelector === "public-parent") {
                    state.publicClicks += 1;
                } else if (
                    state.currentSelector
                    === postPublishAudienceSaveButtonSelector
                ) {
                    state.saveClicks += 1;
                    state.kind = null;
                }
            },
        },
    };
}


const timingOptions = { random: () => 0, sleep: async () => {} };
const emptyPage = {
    async evaluate(callback) {
        if (String(callback).includes("innerWidth")) {
            return { width: 1280, height: 900 };
        }
        return {
            createPostVisible: false,
            found: false,
            kind: null,
            title: "",
            ariaLabel: "",
        };
    },
};
const emptyResult = await handlePostPublishModals(emptyPage, {
    timeout: 200,
    timingOptions,
});
assert.deepEqual(emptyResult.handled, []);

const page = createModalPage();
const result = await handlePostPublishModals(page, {
    timeout: 500,
    timingOptions,
});
assert.deepEqual(result.handled, ["reviewAudience"]);
assert.equal(page.state.continued, 1);
assert.equal(page.state.publicClicks, 1);
assert.equal(page.state.saveClicks, 1);

console.log("Перевірка модалок після Post пройшла успішно");
