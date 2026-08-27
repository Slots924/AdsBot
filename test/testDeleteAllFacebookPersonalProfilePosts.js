import assert from "node:assert/strict";

import deleteAllFacebookPersonalProfilePosts, {
    detectPostMenuActionInPage,
    facebookPersonalProfilePostDeletionStatuses,
    isFeedPostHiddenInPage,
} from "../facebook/actions/deleteAllFacebookPersonalProfilePosts.js";
import {
    getPersonalProfileFeedPostActionsButtonSelector,
    getPersonalProfileFeedPostSelector,
    personalProfileFeedPostActionButtonSelector,
    personalProfileFeedPostMenuItemSelector,
    personalProfileMoveToTrashButtonSelector,
} from "../facebook/selectors/personalProfileFeedPosts.js";


function createMockPage({ posts = [] } = {}) {
    const state = {
        posts: posts.map((post) => ({
            id: post.id,
            text: post.text ?? post.id,
            href: post.href ?? `https://facebook.test/posts/${post.id}`,
            action: post.action ?? "trash",
            hidden: false,
        })),
        menuOpen: false,
        trashDialogOpen: false,
        targetIndex: 0,
        actionsClicks: 0,
        trashClicks: 0,
        moveClicks: 0,
        hideClicks: 0,
        reloadCalls: 0,
        currentSelector: null,
    };

    const postAt = (posinset) => state.posts[posinset - 1] ?? null;
    const snapshotOf = (posinset) => {
        const post = postAt(posinset);

        if (!post) {
            return null;
        }

        return {
            href: post.href,
            text: post.hidden ? `Undo ${post.text}` : post.text,
            images: [],
        };
    };
    const selectorVisible = (selector) => {
        if (typeof selector !== "string") {
            return false;
        }

        const postMatch = /^\[aria-posinset="(\d+)"\]$/.exec(selector);

        if (postMatch) {
            return Boolean(postAt(Number(postMatch[1])));
        }

        if (selector.includes('aria-label^="Actions for this post by"')) {
            const posinset = Number(
                /aria-posinset="(\d+)"/.exec(selector)?.[1]
            );
            const post = postAt(posinset);
            return Boolean(post && !post.hidden);
        }

        if (selector === personalProfileFeedPostMenuItemSelector) {
            return state.menuOpen;
        }

        if (selector === personalProfileMoveToTrashButtonSelector) {
            return state.trashDialogOpen;
        }

        if (selector === personalProfileFeedPostActionButtonSelector) {
            return state.menuOpen || state.posts.some((post) => post.hidden);
        }

        return false;
    };
    const createHandle = (selector) => ({
        asElement() {
            return this;
        },
        async dispose() {},
        async evaluate() {},
        async boundingBox() {
            state.currentSelector = selector;
            return { x: 80, y: 120, width: 160, height: 36 };
        },
    });
    const missingHandle = {
        asElement: () => null,
        async dispose() {},
    };

    return {
        state,
        url() {
            return "https://www.facebook.com/me";
        },
        async reload() {
            state.reloadCalls += 1;
        },
        async evaluate(fn, ...args) {
            if (fn.name === "readPostSnapshotInPage") {
                return snapshotOf(args[0]);
            }

            if (fn.name === "isFeedPostHiddenInPage") {
                return Boolean(postAt(args[0])?.hidden);
            }

            if (fn.name === "waitForDomQuietInPage") {
                return true;
            }

            return { width: 1280, height: 900 };
        },
        async evaluateHandle(_fn, locator) {
            if (locator && typeof locator === "object") {
                if (locator.type === "text") {
                    const expected = String(locator.expectedText ?? "")
                        .toLocaleLowerCase();
                    const available = expected.includes("move to trash")
                        ? state.menuOpen
                            && postAt(state.targetIndex + 1)?.action === "trash"
                        : expected.includes("hide from profile")
                            ? state.menuOpen
                                && postAt(state.targetIndex + 1)?.action === "hide"
                            : false;

                    return available
                        ? createHandle(
                            expected.includes("hide")
                                ? "hide"
                                : personalProfileFeedPostMenuItemSelector
                        )
                        : missingHandle;
                }

                if (locator.type === "selector") {
                    return selectorVisible(locator.selector)
                        ? createHandle(locator.selector)
                        : missingHandle;
                }
            }

            return selectorVisible(locator)
                ? createHandle(locator)
                : missingHandle;
        },
        async waitForFunction(fn, _options, ...args) {
            if (String(fn).includes("readyState")) {
                return { async dispose() {} };
            }

            if (fn.name === "detectPostMenuActionInPage") {
                if (!state.menuOpen) {
                    throw new Error("timeout: menu action");
                }

                return {
                    async jsonValue() {
                        return postAt(state.targetIndex + 1)?.action === "hide"
                            ? "hide"
                            : "trash";
                    },
                    async dispose() {},
                };
            }

            if (fn.name === "isFeedPostHiddenInPage") {
                if (!postAt(args[0])?.hidden) {
                    throw new Error("timeout: hidden");
                }

                return { async dispose() {} };
            }

            if (args[0] && typeof args[0] === "object" && args[0].type === "text") {
                const expected = String(args[0].expectedText ?? "")
                    .toLocaleLowerCase();
                const post = postAt(state.targetIndex + 1);
                const visible = expected.includes("move to trash")
                    ? state.menuOpen && post?.action === "trash"
                    : expected.includes("hide from profile")
                        ? state.menuOpen && post?.action === "hide"
                        : false;

                if (!visible) {
                    throw new Error(`timeout: ${expected}`);
                }

                return { async dispose() {} };
            }

            if (
                args.length === 2
                && args[1]
                && typeof args[1] === "object"
                && "text" in args[1]
            ) {
                const current = snapshotOf(args[0]);

                if (
                    current
                    && JSON.stringify(current) === JSON.stringify(args[1])
                ) {
                    throw new Error("timeout: snapshot");
                }

                return { async dispose() {} };
            }

            const locator = args[0];
            const selector = typeof locator === "string"
                ? locator
                : locator?.selector;

            if (!selectorVisible(selector)) {
                throw new Error(`timeout: ${selector}`);
            }

            return { async dispose() {} };
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                const selector = state.currentSelector;

                if (
                    typeof selector === "string"
                    && selector.includes('aria-label^="Actions for this post by"')
                ) {
                    const posinset = Number(
                        /aria-posinset="(\d+)"/.exec(selector)?.[1]
                    );
                    state.actionsClicks += 1;
                    state.targetIndex = posinset - 1;
                    state.menuOpen = true;
                    return;
                }

                if (selector === personalProfileFeedPostMenuItemSelector) {
                    state.trashClicks += 1;
                    state.menuOpen = false;
                    state.trashDialogOpen = true;
                    return;
                }

                if (selector === personalProfileMoveToTrashButtonSelector) {
                    state.moveClicks += 1;
                    state.trashDialogOpen = false;
                    state.posts.splice(state.targetIndex, 1);
                    return;
                }

                if (selector === "hide") {
                    state.hideClicks += 1;
                    state.menuOpen = false;
                    if (state.posts[state.targetIndex]) {
                        state.posts[state.targetIndex].hidden = true;
                    }
                }
            },
        },
    };
}


const timingOptions = {
    random: () => 0,
    sleep: async () => {},
};
const silentLogger = {
    info() {},
    warn() {},
    error() {},
};


assert.equal(
    isFeedPostHiddenInPage.toString().includes("unhide post"),
    true
);
assert.equal(
    detectPostMenuActionInPage.toString().includes("move to trash"),
    true
);

const emptyPage = createMockPage({ posts: [] });
const empty = await deleteAllFacebookPersonalProfilePosts(
    emptyPage,
    { timeout: 100, logger: silentLogger, ...timingOptions }
);
assert.equal(empty.status, facebookPersonalProfilePostDeletionStatuses.NO_POSTS);
assert.equal(empty.success, true);
assert.equal(empty.processedCount, 0);
assert.equal(emptyPage.state.reloadCalls, 1);

const trashPage = createMockPage({
    posts: [{ id: "one", text: "First post" }],
});
const trashResult = await deleteAllFacebookPersonalProfilePosts(trashPage, {
    timeout: 100,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(
    trashResult.status,
    facebookPersonalProfilePostDeletionStatuses.CLEANED
);
assert.equal(trashResult.deletedCount, 1);
assert.equal(trashResult.hiddenCount, 0);
assert.equal(trashPage.state.actionsClicks, 1);
assert.equal(trashPage.state.trashClicks, 1);
assert.equal(trashPage.state.moveClicks, 1);
assert.equal(trashPage.state.posts.length, 0);
assert.equal(trashPage.state.reloadCalls, 1);

const hidePage = createMockPage({
    posts: [{ id: "sys", action: "hide", text: "Updated cover photo" }],
});
const hideResult = await deleteAllFacebookPersonalProfilePosts(hidePage, {
    timeout: 100,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(
    hideResult.status,
    facebookPersonalProfilePostDeletionStatuses.CLEANED
);
assert.equal(hideResult.hiddenCount, 1);
assert.equal(hideResult.deletedCount, 0);
assert.equal(hidePage.state.hideClicks, 1);
assert.equal(hidePage.state.posts[0].hidden, true);

const mixedPage = createMockPage({
    posts: [
        { id: "hide-me", action: "hide" },
        { id: "trash-me", action: "trash" },
    ],
});
const mixedResult = await deleteAllFacebookPersonalProfilePosts(mixedPage, {
    timeout: 100,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(
    mixedResult.status,
    facebookPersonalProfilePostDeletionStatuses.CLEANED
);
assert.equal(mixedResult.hiddenCount, 1);
assert.equal(mixedResult.deletedCount, 1);
assert.equal(mixedPage.state.posts.length, 1);
assert.equal(mixedPage.state.posts[0].hidden, true);

const limitPage = createMockPage({
    posts: Array.from({ length: 21 }, (_, index) => ({
        id: `post-${index + 1}`,
    })),
});
const limitResult = await deleteAllFacebookPersonalProfilePosts(limitPage, {
    timeout: 100,
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(
    limitResult.status,
    facebookPersonalProfilePostDeletionStatuses.CLEANED
);
assert.equal(limitResult.processedCount, 20);
assert.equal(limitResult.deletedCount, 20);
assert.equal(limitPage.state.posts.length, 1);

const invalid = await deleteAllFacebookPersonalProfilePosts(null, {
    logger: silentLogger,
    ...timingOptions,
});
assert.equal(
    invalid.status,
    facebookPersonalProfilePostDeletionStatuses.INVALID_INPUT
);

assert.equal(
    getPersonalProfileFeedPostSelector(2),
    '[aria-posinset="2"]'
);
assert.equal(
    getPersonalProfileFeedPostActionsButtonSelector(2).includes('[aria-posinset="2"]'),
    true
);

console.log("deleteAllFacebookPersonalProfilePosts contract tests passed");
