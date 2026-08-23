import assert from "node:assert/strict";

import deleteAllFacebookPersonalProfilePosts, {
    facebookPersonalProfilePostDeletionStatuses,
} from "../facebook/actions/deleteAllFacebookPersonalProfilePosts.js";
import {
    personalProfileDeleteConfirmationButtonCandidatesSelector,
    personalProfileManagePostsActionRadioSelector,
    personalProfileManagePostsButtonCandidatesSelector,
    personalProfileManagePostsButtonSelector,
    personalProfileManagePostsCheckboxSelector,
    personalProfileManagePostsCloseButtonSelector,
    personalProfileManagePostsDialogSelector,
    personalProfileManagePostsDoneButtonSelector,
    personalProfileManagePostsNextButtonSelector,
} from "../facebook/selectors/personalProfileManagePosts.js";


function createMockPage({
    posts = [],
    systemPostsLeftAfterHide = 0,
    ordinaryPostsLeftAfterDelete = 0,
} = {}) {
    const state = {
        posts: posts.map((post) => ({ ...post })),
        selected: new Set(),
        dialogVisible: false,
        mode: "profile",
        currentTarget: null,
        pendingAction: null,
        manageOpens: 0,
        selectAllClicks: 0,
        checkboxClicks: 0,
        nextClicks: 0,
        hideDoneClicks: 0,
        deleteDoneClicks: 0,
        confirmationClicks: 0,
        wheelCalls: 0,
        navigations: 0,
    };

    const details = ({
        text = "",
        accessibleName = text,
        checked = null,
        disabled = false,
        sectionKey = "",
        postKey = "",
        systemPost = false,
    } = {}) => ({
        visible: true,
        text,
        accessibleName,
        checked,
        disabled,
        sectionKey,
        postKey,
        systemPost,
    });

    const createHandle = (kind, elementDetails = details()) => ({
        kind,
        asElement() {
            return this;
        },
        async dispose() {},
        async evaluate() {
            return elementDetails;
        },
        async boundingBox() {
            state.currentTarget = kind;
            return { x: 100, y: 100, width: 220, height: 44 };
        },
    });
    const nullHandle = {
        asElement: () => null,
        async dispose() {},
    };

    const openManage = () => {
        state.dialogVisible = true;
        state.mode = "selection";
        state.selected.clear();
        state.manageOpens += 1;
    };
    const visibleSelectorHandle = (selector) => {
        if (selector === personalProfileManagePostsDialogSelector) {
            return state.dialogVisible ? createHandle("dialog") : nullHandle;
        }
        if (selector === personalProfileManagePostsButtonSelector) {
            return !state.dialogVisible ? createHandle("manage") : nullHandle;
        }
        if (selector === personalProfileManagePostsNextButtonSelector) {
            return state.dialogVisible && state.mode === "selection"
                ? createHandle("next")
                : nullHandle;
        }
        if (selector === personalProfileManagePostsDoneButtonSelector) {
            return state.dialogVisible && state.mode === "actions"
                ? createHandle("done")
                : nullHandle;
        }
        if (selector === personalProfileManagePostsCloseButtonSelector) {
            return state.dialogVisible
                ? createHandle("close")
                : nullHandle;
        }
        return nullHandle;
    };

    return {
        state,
        url() {
            return "https://www.facebook.com/me";
        },
        async evaluateOnNewDocument() {},
        async goto() {
            state.dialogVisible = false;
            state.mode = "profile";
            state.currentTarget = null;
            state.navigations += 1;
        },
        async evaluateHandle(_callback, selector) {
            return visibleSelectorHandle(selector);
        },
        async evaluate(_callback, ...args) {
            if (args.length === 0) return { width: 1280, height: 900 };
            if (typeof args[0] === "object" && args[0]?.kind) return true;
            if (args[0] !== personalProfileManagePostsDialogSelector) {
                return null;
            }

            const selectedCount = state.selected.size;
            const mappedPosts = state.posts.map((post) => ({
                key: post.key,
                systemPost: post.systemPost,
                selected: state.selected.has(post.key),
                visible: true,
            }));
            const selectableSections = new Set(
                state.posts
                    .filter((post) => !post.systemPost)
                    .filter((post) => !state.selected.has(post.key))
                    .map((post) => post.section)
            );

            return {
                dialogVisible: state.dialogVisible,
                selectedCount,
                visibleSelectAllCount:
                    state.mode === "selection" ? selectableSections.size : 0,
                visibleAddCheckboxCount:
                    state.mode === "selection"
                        ? state.posts.length - selectedCount
                        : 0,
                postCheckboxCount: state.posts.length,
                posts: mappedPosts,
                systemPostCount: mappedPosts
                    .filter((post) => post.systemPost).length,
                ordinaryPostCount: mappedPosts
                    .filter((post) => !post.systemPost).length,
                scrollTop: 0,
                clientHeight: 700,
                scrollHeight: 700,
                atBottom: true,
            };
        },
        async $$(selector) {
            if (
                selector === personalProfileManagePostsCheckboxSelector
                && state.dialogVisible
                && state.mode === "selection"
            ) {
                return state.posts
                    .filter((post) => !state.selected.has(post.key))
                    .map((post) => createHandle(
                        `checkbox:${post.key}`,
                        details({
                            postKey: post.key,
                            systemPost: post.systemPost,
                        })
                    ));
            }
            if (
                selector === personalProfileManagePostsButtonCandidatesSelector
                && state.dialogVisible
                && state.mode === "selection"
            ) {
                const sections = [...new Set(
                    state.posts
                        .filter((post) => !post.systemPost)
                        .filter((post) => !state.selected.has(post.key))
                        .map((post) => post.section)
                )];
                return sections.map((section) => createHandle(
                    `select:${section}`,
                    details({ text: "Select all", sectionKey: section })
                ));
            }
            if (
                selector === personalProfileManagePostsActionRadioSelector
                && state.dialogVisible
                && state.mode === "actions"
            ) {
                const selectedPosts = state.posts.filter((post) =>
                    state.selected.has(post.key)
                );
                const onlySystem = selectedPosts.length > 0
                    && selectedPosts.every((post) => post.systemPost);
                const onlyOrdinary = selectedPosts.length > 0
                    && selectedPosts.every((post) => !post.systemPost);

                return [
                    createHandle("radio:Hide posts", details({
                        accessibleName: "Hide posts Hide posts from your timeline",
                        disabled: !onlySystem,
                    })),
                    createHandle("radio:Delete posts", details({
                        accessibleName: "Delete posts Delete posts you've created",
                        disabled: !onlyOrdinary,
                    })),
                ];
            }
            if (
                selector
                    === personalProfileDeleteConfirmationButtonCandidatesSelector
                && state.dialogVisible
                && state.mode === "confirmation"
            ) {
                return [createHandle("confirm-delete", details({
                    text: "Delete",
                    accessibleName: "Delete",
                }))];
            }
            return [];
        },
        async waitForFunction(_callback, _options, ...args) {
            const [selector] = args;
            const completionWait = args.length === 2
                && args[1] === personalProfileManagePostsActionRadioSelector;

            if (completionWait || args.length === 0) {
                return { async dispose() {} };
            }
            if (
                args.length === 1
                && selector === personalProfileManagePostsDialogSelector
            ) {
                return { async dispose() {} };
            }
            if (
                selector === personalProfileManagePostsButtonSelector
                || selector === personalProfileManagePostsDialogSelector
                || selector === personalProfileManagePostsNextButtonSelector
                || selector === personalProfileManagePostsDoneButtonSelector
                || selector === personalProfileManagePostsCloseButtonSelector
            ) {
                if (!visibleSelectorHandle(selector).asElement()) {
                    throw new Error(`selector timeout: ${selector}`);
                }
            }
            return { async dispose() {} };
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                const target = state.currentTarget;

                if (target === "manage") {
                    openManage();
                } else if (target === "close") {
                    state.dialogVisible = false;
                    state.mode = "profile";
                } else if (target?.startsWith("checkbox:")) {
                    state.selected.add(target.slice("checkbox:".length));
                    state.checkboxClicks += 1;
                } else if (target?.startsWith("select:")) {
                    const section = target.slice("select:".length);
                    for (const post of state.posts) {
                        if (!post.systemPost && post.section === section) {
                            state.selected.add(post.key);
                        }
                    }
                    state.selectAllClicks += 1;
                } else if (target === "next") {
                    state.mode = "actions";
                    state.nextClicks += 1;
                } else if (target?.startsWith("radio:")) {
                    state.pendingAction = target.slice("radio:".length);
                } else if (target === "done") {
                    if (state.pendingAction === "Hide posts") {
                        const selectedSystem = state.posts.filter((post) =>
                            post.systemPost && state.selected.has(post.key)
                        );
                        const removable = Math.max(
                            0,
                            selectedSystem.length - systemPostsLeftAfterHide
                        );
                        const hiddenKeys = new Set(
                            selectedSystem.slice(0, removable)
                                .map((post) => post.key)
                        );
                        state.posts = state.posts.filter(
                            (post) => !hiddenKeys.has(post.key)
                        );
                        state.selected.clear();
                        state.dialogVisible = false;
                        state.mode = "profile";
                        state.hideDoneClicks += 1;
                    } else {
                        state.mode = "confirmation";
                        state.deleteDoneClicks += 1;
                    }
                } else if (target === "confirm-delete") {
                    const selectedOrdinary = state.posts.filter((post) =>
                        !post.systemPost && state.selected.has(post.key)
                    );
                    const removable = Math.max(
                        0,
                        selectedOrdinary.length - ordinaryPostsLeftAfterDelete
                    );
                    const deletedKeys = new Set(
                        selectedOrdinary.slice(0, removable)
                            .map((post) => post.key)
                    );
                    state.posts = state.posts.filter(
                        (post) => !deletedKeys.has(post.key)
                    );
                    state.selected.clear();
                    state.confirmationClicks += 1;
                    state.dialogVisible = false;
                    state.mode = "profile";
                }
            },
            async wheel() {
                state.wheelCalls += 1;
            },
        },
    };
}


const sourcePosts = [
    { key: "system-avatar", systemPost: true, section: "August 2026" },
    { key: "system-cover", systemPost: true, section: "August 2026" },
    { key: "ordinary-1", systemPost: false, section: "August 2026" },
    { key: "ordinary-2", systemPost: false, section: "August 2026" },
    { key: "ordinary-3", systemPost: false, section: "October 1981" },
];
const logEntries = [];
const logger = {
    child() { return this; },
    debug(event, message, fields) {
        logEntries.push({ level: "debug", event, message, fields });
    },
    info(event, message, fields) {
        logEntries.push({ level: "info", event, message, fields });
    },
    warn(event, message, fields) {
        logEntries.push({ level: "warn", event, message, fields });
    },
    error(event, message, fields) {
        logEntries.push({ level: "error", event, message, fields });
    },
};
const timingOptions = {
    random: () => 0,
    sleep: async () => {},
    logger,
};

const page = createMockPage({ posts: sourcePosts });
const result = await deleteAllFacebookPersonalProfilePosts(page, {
    timeout: 100,
    ...timingOptions,
});

assert.equal(result.success, true, JSON.stringify({ result, state: page.state }));
assert.equal(result.status, facebookPersonalProfilePostDeletionStatuses.CLEANED);
assert.equal(result.systemSelectedCount, 2);
assert.equal(result.hiddenSystemCount, 2);
assert.equal(result.systemHideVerified, true);
assert.equal(result.ordinarySelectedCount, 3);
assert.equal(result.deletedOrdinaryCount, 3);
assert.equal(result.verification.totalCount, 0);
assert.equal(result.managerClosed, true);
assert.equal(page.state.dialogVisible, false);
assert.equal(page.state.checkboxClicks, 2);
assert.equal(page.state.selectAllClicks, 2);
assert.equal(page.state.hideDoneClicks, 1);
assert.equal(page.state.deleteDoneClicks, 1);
assert.equal(page.state.confirmationClicks, 1);
assert.equal(page.state.navigations, 0);
assert.ok(logEntries.some((entry) =>
    entry.event === "facebook.personal_posts.selector.search"
));
assert.ok(logEntries.some((entry) =>
    entry.event === "facebook.personal_posts.selector.found"
));
assert.ok(logEntries.some((entry) =>
    entry.event === "facebook.personal_posts.manager.closed"
));

const ordinaryOnlyProgress = [];
const ordinaryOnlyPage = createMockPage({
    posts: sourcePosts.filter((post) => !post.systemPost),
});
const ordinaryOnly = await deleteAllFacebookPersonalProfilePosts(
    ordinaryOnlyPage,
    {
        timeout: 100,
        ...timingOptions,
        onProgress: (event) => ordinaryOnlyProgress.push(event),
    }
);
assert.equal(ordinaryOnly.success, true);
assert.equal(ordinaryOnly.systemSelectedCount, 0);
assert.equal(ordinaryOnlyPage.state.hideDoneClicks, 0);
assert.equal(ordinaryOnlyPage.state.deleteDoneClicks, 1);
assert.equal(ordinaryOnlyPage.state.dialogVisible, false);
assert.ok(ordinaryOnlyProgress.some((event) =>
    event.type === "system_posts_absent"
));
assert.ok(!ordinaryOnlyProgress.some((event) =>
    event.type === "reopen_manage_posts_after_hide"
));

const systemRemainderPage = createMockPage({
    posts: sourcePosts,
    systemPostsLeftAfterHide: 1,
});
const systemRemainder = await deleteAllFacebookPersonalProfilePosts(
    systemRemainderPage,
    { timeout: 100, ...timingOptions }
);
assert.equal(systemRemainder.success, false);
assert.equal(
    systemRemainder.status,
    facebookPersonalProfilePostDeletionStatuses.SYSTEM_POSTS_REMAIN
);
assert.equal(systemRemainder.verification.systemCount, 1);
assert.equal(systemRemainder.verification.ordinaryCount, 0);
assert.equal(systemRemainder.systemHideSubmittedCount, 2);
assert.equal(systemRemainder.hiddenSystemCount, 1);
assert.equal(systemRemainderPage.state.selectAllClicks, 0);
assert.equal(systemRemainderPage.state.checkboxClicks, 5);

const ordinaryRemainderPage = createMockPage({
    posts: sourcePosts,
    ordinaryPostsLeftAfterDelete: 1,
});
const ordinaryRemainder = await deleteAllFacebookPersonalProfilePosts(
    ordinaryRemainderPage,
    { timeout: 100, ...timingOptions }
);
assert.equal(
    ordinaryRemainder.status,
    facebookPersonalProfilePostDeletionStatuses.ORDINARY_POSTS_REMAIN
);
assert.equal(ordinaryRemainder.verification.ordinaryCount, 1);
assert.equal(ordinaryRemainder.ordinaryDeleteSubmittedCount, 3);
assert.equal(ordinaryRemainder.deletedOrdinaryCount, 2);

const emptyPage = createMockPage({ posts: [] });
const empty = await deleteAllFacebookPersonalProfilePosts(emptyPage, {
    timeout: 100,
    ...timingOptions,
});
assert.equal(empty.success, true);
assert.equal(empty.status, facebookPersonalProfilePostDeletionStatuses.NO_POSTS);
assert.equal(emptyPage.state.hideDoneClicks, 0);
assert.equal(emptyPage.state.deleteDoneClicks, 0);
assert.equal(emptyPage.state.manageOpens, 1);
assert.equal(emptyPage.state.wheelCalls, 0);
assert.equal(emptyPage.state.dialogVisible, false);
assert.equal(empty.managerClosed, true);

const invalid = await deleteAllFacebookPersonalProfilePosts(null, {
    timeout: 100,
    ...timingOptions,
});
assert.equal(invalid.success, false);
assert.equal(
    invalid.status,
    facebookPersonalProfilePostDeletionStatuses.INVALID_INPUT
);

for (const selector of [
    personalProfileManagePostsButtonSelector,
    personalProfileManagePostsDialogSelector,
    personalProfileManagePostsCheckboxSelector,
    personalProfileManagePostsCloseButtonSelector,
    personalProfileManagePostsNextButtonSelector,
    personalProfileManagePostsDoneButtonSelector,
]) {
    assert.match(selector, / i\]/, `selector is not case-insensitive: ${selector}`);
}

console.log("deleteAllFacebookPersonalProfilePosts contract tests passed");
