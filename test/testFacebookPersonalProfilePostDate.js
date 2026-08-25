import assert from "node:assert/strict";

import changeFacebookPersonalProfilePostDate, {
    facebookPersonalProfilePostDateStatuses,
    parseFacebookPersonalProfilePostDate,
} from "../facebook/actions/changeFacebookPersonalProfilePostDate.js";
import openFacebookPersonalProfileFirstFeedPost, {
    extractFacebookFeedPostId,
    facebookPersonalProfileFirstFeedPostStatuses,
    isFeedFingerprintChanged,
    normalizeFacebookFeedPostUrl,
    readFirstFeedPostFingerprint,
} from "../facebook/actions/openFacebookPersonalProfileFirstFeedPost.js";
import publishFacebookPersonalProfileMediaPostsWithDates, {
    facebookPersonalProfilePostsWithDatesStatuses,
} from "../facebook/actions/publishFacebookPersonalProfileMediaPostsWithDates.js";
import isPostAvailable from "../facebook/post/checks/isPostAvailable.js";
import {
    personalProfileFirstFeedPostCftLinkSelector,
    personalProfileFirstFeedPostPermalinkLinkSelector,
    personalProfileFirstFeedPostSelector,
} from "../facebook/selectors/personalProfilePost.js";
import { postDialogSelector } from "../facebook/selectors/post.js";


assert.deepEqual(
    parseFacebookPersonalProfilePostDate("04/22/2020"),
    {
        year: 2020,
        month: 4,
        day: 22,
        isoDate: "2020-04-22",
        inputDate: "04/22/2020",
    }
);
assert.equal(
    parseFacebookPersonalProfilePostDate("Apr 22, 2020")?.isoDate,
    "2020-04-22"
);
assert.equal(
    parseFacebookPersonalProfilePostDate("April 22, 2020")?.inputDate,
    "04/22/2020"
);
assert.equal(
    parseFacebookPersonalProfilePostDate("2020-04-22")?.isoDate,
    "2020-04-22"
);
assert.equal(parseFacebookPersonalProfilePostDate("02/30/2020"), null);

const logEvents = [];
const logger = {
    info(message, fields) {
        logEvents.push({ level: "info", message, fields });
    },
    error(message, fields) {
        logEvents.push({ level: "error", message, fields });
    },
    warn(message, fields) {
        logEvents.push({ level: "warn", message, fields });
    },
};
const availablePage = {
    async evaluate() {
        return {
            available: true,
            dialogFound: true,
            dialogName: "Adi Chandra's Post",
            unavailableText: null,
        };
    },
};
assert.equal(await isPostAvailable(availablePage, { logger }), true);
assert.ok(logEvents.some(({ message }) =>
    message.includes("Модальне вікно доступного поста знайдено")
));

const unavailablePage = {
    async evaluate() {
        return {
            available: false,
            dialogFound: true,
            dialogName: "Adi Chandra's Post",
            unavailableText: "This content isn't available",
        };
    },
};
assert.equal(await isPostAvailable(unavailablePage, { logger }), false);

const invalidDateResult = await changeFacebookPersonalProfilePostDate(null, {
    targetDate: "not-a-date",
    logger,
});
assert.equal(invalidDateResult.success, false);
assert.equal(
    invalidDateResult.status,
    facebookPersonalProfilePostDateStatuses.INVALID_INPUT
);

const invalidBatchResult = await publishFacebookPersonalProfileMediaPostsWithDates(
    null,
    {
        posts: [],
        logger,
    }
);
assert.equal(invalidBatchResult.success, false);
assert.equal(
    invalidBatchResult.status,
    facebookPersonalProfilePostsWithDatesStatuses.INVALID_INPUT
);
assert.equal(invalidBatchResult.datePhaseStarted, false);
assert.equal(
    facebookPersonalProfilePostsWithDatesStatuses.POST_URL_CAPTURE_FAILED,
    "POST_URL_CAPTURE_FAILED"
);
assert.equal(
    facebookPersonalProfilePostsWithDatesStatuses.FIRST_FEED_POST_OPEN_FAILED,
    "FIRST_FEED_POST_OPEN_FAILED"
);

assert.equal(
    normalizeFacebookFeedPostUrl(
        "https://www.facebook.com/photo/?fbid=111&__cft__[0]=abc#frag"
    ),
    "https://www.facebook.com/photo/?fbid=111"
);
assert.equal(
    extractFacebookFeedPostId("https://www.facebook.com/photo/?fbid=111"),
    "111"
);

const timingOptions = {
    random: () => 0,
    sleep: async () => {},
};

function createFeedPage({
    fingerprint = {
        cft: "https://www.facebook.com/photo/?fbid=111&__cft__[0]=abc",
        permalink: null,
    },
    openDialog = true,
    pageUrlAfterClick = "https://www.facebook.com/me",
    dialogPermalink = "https://www.facebook.com/photo/?fbid=111&__cft__[0]=abc",
} = {}) {
    const state = {
        fingerprint,
        dialogOpen: false,
        currentUrl: "https://www.facebook.com/me",
        currentTarget: null,
    };

    const createHandle = (available = true) => ({
        asElement() {
            return available ? this : null;
        },
        async dispose() {},
        async evaluate() {},
        async boundingBox() {
            state.currentTarget = { fingerprint: state.fingerprint };
            return available
                ? { x: 120, y: 180, width: 80, height: 18 }
                : null;
        },
    });

    return {
        state,
        url() {
            return state.currentUrl;
        },
        async evaluate(callback) {
            const source = String(callback);
            if (source.includes("innerWidth")) {
                return { width: 1280, height: 900 };
            }
            if (source.includes("story_fbid") || source.includes("/photo/")) {
                return state.dialogOpen ? dialogPermalink : null;
            }
            return state.fingerprint;
        },
        async evaluateHandle(_callback, selector) {
            const available = (
                selector === personalProfileFirstFeedPostCftLinkSelector
                && Boolean(state.fingerprint?.cft)
            ) || (
                selector === personalProfileFirstFeedPostPermalinkLinkSelector
                && Boolean(state.fingerprint?.permalink)
            );
            return createHandle(available);
        },
        async waitForFunction(callback, _options, ...args) {
            const source = String(callback);
            const [firstArg] = args;

            if (
                firstArg === personalProfileFirstFeedPostSelector
                || source.includes("__cft__") && source.includes("previous")
            ) {
                if (!state.fingerprint) {
                    throw new Error("card timeout");
                }
                return createHandle();
            }
            if (firstArg === personalProfileFirstFeedPostCftLinkSelector) {
                if (!state.fingerprint?.cft) {
                    throw new Error("cft timeout");
                }
                return createHandle();
            }
            if (firstArg === personalProfileFirstFeedPostPermalinkLinkSelector) {
                if (!state.fingerprint?.permalink) {
                    throw new Error("permalink timeout");
                }
                return createHandle();
            }
            if (
                firstArg === postDialogSelector
                && source.includes("story_fbid")
            ) {
                if (!state.dialogOpen) {
                    throw new Error("permalink timeout");
                }
                return createHandle();
            }
            if (firstArg === postDialogSelector) {
                if (!state.dialogOpen) {
                    throw new Error("dialog timeout");
                }
                return createHandle();
            }
            if (!state.fingerprint) {
                throw new Error("selector timeout");
            }
            return createHandle();
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                if (!state.fingerprint) return;
                if (openDialog) {
                    state.dialogOpen = true;
                    state.currentUrl = pageUrlAfterClick;
                }
            },
        },
    };
}

assert.equal(
    isFeedFingerprintChanged(
        { cft: null, permalink: null },
        { cft: "https://facebook.com/x?__cft__[0]=1", permalink: null }
    ),
    true
);
assert.equal(
    isFeedFingerprintChanged(
        { cft: "old", permalink: null },
        { cft: "old", permalink: "https://www.facebook.com/permalink.php?story_fbid=1" }
    ),
    true
);
assert.equal(
    isFeedFingerprintChanged(
        { cft: "same", permalink: "same" },
        { cft: "same", permalink: "same" }
    ),
    false
);

const missingCardPage = createFeedPage({ fingerprint: null });
assert.deepEqual(
    await readFirstFeedPostFingerprint(missingCardPage),
    { cft: null, permalink: null }
);
const missingCardResult = await openFacebookPersonalProfileFirstFeedPost(
    missingCardPage,
    {
        timeout: 50,
        logger,
        ...timingOptions,
    }
);
assert.equal(missingCardResult.success, false);
assert.equal(
    missingCardResult.status,
    facebookPersonalProfileFirstFeedPostStatuses.CARD_NOT_FOUND
);

const openedPage = createFeedPage();
assert.deepEqual(
    await readFirstFeedPostFingerprint(openedPage),
    {
        cft: "https://www.facebook.com/photo/?fbid=111&__cft__[0]=abc",
        permalink: null,
    }
);
const openedResult = await openFacebookPersonalProfileFirstFeedPost(
    openedPage,
    {
        previousFingerprint: null,
        timeout: 50,
        logger,
        ...timingOptions,
    }
);
assert.equal(openedResult.success, true, JSON.stringify(openedResult));
assert.equal(
    openedResult.status,
    facebookPersonalProfileFirstFeedPostStatuses.OPENED
);
assert.equal(openedResult.postUrl, "https://www.facebook.com/photo/?fbid=111");
assert.equal(openedResult.postId, "111");
assert.equal(openedPage.state.dialogOpen, true);

const permalinkPage = createFeedPage({
    fingerprint: {
        cft: null,
        permalink: "https://www.facebook.com/permalink.php?story_fbid=999&id=123",
    },
    dialogPermalink:
        "https://www.facebook.com/permalink.php?story_fbid=999&id=123",
});
assert.deepEqual(
    await readFirstFeedPostFingerprint(permalinkPage),
    {
        cft: null,
        permalink: "https://www.facebook.com/permalink.php?story_fbid=999&id=123",
    }
);
const permalinkResult = await openFacebookPersonalProfileFirstFeedPost(
    permalinkPage,
    {
        previousFingerprint: { cft: null, permalink: null },
        timeout: 50,
        logger,
        ...timingOptions,
    }
);
assert.equal(permalinkResult.success, true, JSON.stringify(permalinkResult));
assert.equal(permalinkResult.postId, "999");
assert.equal(permalinkPage.state.dialogOpen, true);

const authorClickPage = createFeedPage({ openDialog: false });
const authorClickResult = await openFacebookPersonalProfileFirstFeedPost(
    authorClickPage,
    {
        previousFingerprint: null,
        timeout: 50,
        logger,
        ...timingOptions,
    }
);
assert.equal(authorClickResult.success, false);
assert.equal(
    authorClickResult.status,
    facebookPersonalProfileFirstFeedPostStatuses.FIRST_FEED_POST_OPEN_FAILED
);
assert.equal(authorClickPage.state.dialogOpen, false);

function createOpenPostDatePage() {
    const state = {
        postDialogOpen: true,
        editDateOpen: false,
        formattedDate: "Just now",
        currentKind: null,
    };

    const createHandle = (kind, available = true) => ({
        kind,
        asElement() {
            return available ? this : null;
        },
        async dispose() {},
        async evaluate() {
            return kind === "dateInput" ? state.formattedDate : "";
        },
        async boundingBox() {
            state.currentKind = kind;
            return available
                ? { x: 140, y: 160, width: 90, height: 28 }
                : null;
        },
    });

    return {
        state,
        url() {
            return "https://www.facebook.com/permalink.php?story_fbid=pfbid-new&id=123";
        },
        async evaluate(callback) {
            const source = String(callback);
            if (source.includes("innerWidth")) {
                return { width: 1280, height: 900 };
            }
            if (source.includes("unavailable") || source.includes("isn't")) {
                return {
                    available: true,
                    dialogFound: true,
                    dialogName: "Adi Chandra's Post",
                    unavailableText: null,
                };
            }
            if (source.includes("story_fbid") || source.includes("ariaLabel")) {
                return [{
                    text: "Just now",
                    ariaLabel: "",
                    href: "https://www.facebook.com/permalink.php?story_fbid=pfbid-new&id=123",
                }];
            }
            return [];
        },
        async evaluateHandle(_callback, selectors, kind) {
            if (typeof kind !== "string") {
                return createHandle("unknown", false);
            }
            const available = {
                actions: state.postDialogOpen,
                editDateMenuItem: state.postDialogOpen,
                dateInput: state.editDateOpen,
                done: state.editDateOpen,
                cancel: state.editDateOpen,
                closePost: state.postDialogOpen && !state.editDateOpen,
            }[kind] ?? false;
            return createHandle(kind, available);
        },
        async waitForFunction(callback, _options, ...args) {
            const source = String(callback);
            if (source.includes("edit date")) {
                if (state.editDateOpen !== args[1]) {
                    throw new Error("edit date dialog timeout");
                }
                return createHandle("editDate");
            }
            if (source.includes("!Array.from")) {
                if (state.postDialogOpen) {
                    throw new Error("close dialog timeout");
                }
                return createHandle("closed");
            }
            if (!state.postDialogOpen) {
                throw new Error("post dialog timeout");
            }
            return createHandle("post");
        },
        keyboard: {
            async down() {},
            async up() {},
            async press() {},
            async type() {
                state.formattedDate = "Mar 21, 2024";
            },
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                if (state.currentKind === "editDateMenuItem") {
                    state.editDateOpen = true;
                } else if (state.currentKind === "done") {
                    state.editDateOpen = false;
                } else if (state.currentKind === "closePost") {
                    state.postDialogOpen = false;
                }
            },
        },
    };
}

const savedWithoutVisibleTimestamp = await changeFacebookPersonalProfilePostDate(
    createOpenPostDatePage(),
    {
        targetDate: "03/21/2024",
        timeout: 200,
        logger,
        ...timingOptions,
    }
);
assert.equal(
    savedWithoutVisibleTimestamp.success,
    true,
    JSON.stringify(savedWithoutVisibleTimestamp)
);
assert.equal(
    savedWithoutVisibleTimestamp.status,
    facebookPersonalProfilePostDateStatuses.CHANGED
);
assert.equal(savedWithoutVisibleTimestamp.verified, true);
assert.equal(savedWithoutVisibleTimestamp.postDialogClosed, true);
assert.equal(savedWithoutVisibleTimestamp.formattedDate, "Mar 21, 2024");

console.log("Facebook personal profile post date tests passed");
