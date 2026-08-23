import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import publishFacebookPersonalProfileMediaPost, {
    facebookPersonalProfileMediaPostStatuses,
} from "../facebook/actions/publishFacebookPersonalProfileMediaPost.js";
import {
    personalProfileAudienceDoneButtonSelector,
    personalProfileAudienceRadioSelector,
    personalProfileComposerButtonCandidatesSelector,
    personalProfileCreatePostDialogSelector,
    personalProfilePhotoVideoButtonSelector,
    personalProfilePostPrivacyButtonSelector,
    personalProfilePublishPostButtonSelector,
} from "../facebook/selectors/personalProfilePost.js";


function createMockPage({ applyPrivacy = true } = {}) {
    const state = {
        dialogVisible: false,
        privacyOpen: false,
        audience: "Friends",
        pendingAudience: null,
        acceptedPaths: [],
        mediaReady: false,
        publishClicks: 0,
        chooserCalls: 0,
        currentTarget: null,
    };

    const selectorVisible = (selector) => {
        if (selector === personalProfileCreatePostDialogSelector) {
            return state.dialogVisible;
        }
        if (selector === personalProfilePostPrivacyButtonSelector) {
            return state.dialogVisible && !state.privacyOpen;
        }
        if (selector === personalProfileAudienceDoneButtonSelector) {
            return state.dialogVisible && state.privacyOpen;
        }
        if (selector === personalProfilePhotoVideoButtonSelector) {
            return state.dialogVisible && !state.privacyOpen;
        }
        if (selector === personalProfilePublishPostButtonSelector) {
            return state.dialogVisible && state.mediaReady;
        }

        return false;
    };

    const createHandle = (selector, text = "", available = true) => ({
        asElement() {
            return available ? this : null;
        },
        async dispose() {},
        async evaluate() {
            return text;
        },
        async boundingBox() {
            state.currentTarget = { selector, text };
            return available
                ? { x: 100, y: 100, width: 160, height: 40 }
                : null;
        },
    });

    return {
        state,
        url() {
            return "https://www.facebook.com/me";
        },
        async $$(selector) {
            if (selector === personalProfileComposerButtonCandidatesSelector) {
                return [
                    createHandle(selector, "Manage posts"),
                    createHandle(selector, "What's on your mind?"),
                ];
            }
            if (
                selector === personalProfileAudienceRadioSelector
                && state.privacyOpen
            ) {
                return [
                    createHandle(selector, "PUBLIC\nAnyone on or off Facebook"),
                    createHandle(selector, "Friends\nYour friends on Facebook"),
                ];
            }

            return [];
        },
        async evaluate(callback, selector) {
            if (String(callback).includes('a[href*="story_fbid"]')) {
                return state.publishClicks > 0
                    ? [{
                        href: "https://www.facebook.com/permalink.php?story_fbid=pfbid-new&id=123&__tn__=test",
                        text: "Just now",
                        top: 100,
                    }]
                    : [];
            }
            if (selector === personalProfilePostPrivacyButtonSelector) {
                return state.audience;
            }

            return { width: 1280, height: 900 };
        },
        async evaluateHandle(_callback, selector) {
            return createHandle(
                selector,
                "",
                selectorVisible(selector)
            );
        },
        async waitForFunction(_callback, _options, ...args) {
            if (args.length === 2 && typeof args[1] === "string") {
                const [selector, expectedText] = args;
                const available = selector
                    === personalProfileComposerButtonCandidatesSelector
                    ? expectedText === "What's on your mind?"
                    : selector === personalProfileAudienceRadioSelector
                        && state.privacyOpen
                        && expectedText === "Public"
                        || selector === personalProfilePostPrivacyButtonSelector
                            && state.audience === expectedText;

                if (!available) throw new Error("text element timeout");
                return createHandle(selector, expectedText);
            }

            const [selector] = args;

            if (
                selector === personalProfileCreatePostDialogSelector
                && state.publishClicks > 0
            ) {
                state.dialogVisible = false;
                return createHandle(selector);
            }
            if (!selectorVisible(selector)) {
                throw new Error(`selector timeout: ${selector}`);
            }

            return createHandle(selector);
        },
        async waitForFileChooser() {
            state.chooserCalls += 1;

            return {
                async accept(paths) {
                    state.acceptedPaths = [...paths];
                    state.mediaReady = true;
                },
            };
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                const { selector, text } = state.currentTarget ?? {};

                if (
                    selector === personalProfileComposerButtonCandidatesSelector
                    && text === "What's on your mind?"
                ) {
                    state.dialogVisible = true;
                } else if (selector === personalProfilePostPrivacyButtonSelector) {
                    state.privacyOpen = true;
                } else if (
                    selector === personalProfileAudienceRadioSelector
                    && text.toLocaleLowerCase().startsWith("public")
                ) {
                    state.pendingAudience = "Public";
                } else if (selector === personalProfileAudienceDoneButtonSelector) {
                    if (applyPrivacy) state.audience = state.pendingAudience;
                    state.privacyOpen = false;
                } else if (selector === personalProfilePublishPostButtonSelector) {
                    state.publishClicks += 1;
                }
            },
        },
    };
}


const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-personal-media-post-")
);
const imagePath = path.join(temporaryDirectory, "photo.jpg");
const videoPath = path.join(temporaryDirectory, "video.mp4");
await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
await writeFile(videoPath, Buffer.from([0x00, 0x00, 0x00, 0x18]));

const timingOptions = {
    random: () => 0,
    sleep: async () => {},
};

try {
    const page = createMockPage();
    const result = await publishFacebookPersonalProfileMediaPost(page, {
        mediaPaths: [imagePath, videoPath],
        timeout: 100,
        ...timingOptions,
    });

    assert.equal(result.success, true, JSON.stringify({ result, state: page.state }));
    assert.equal(
        result.status,
        facebookPersonalProfileMediaPostStatuses.PUBLISHED
    );
    assert.equal(result.audience, "Public");
    assert.equal(result.mediaCount, 2);
    assert.deepEqual(page.state.acceptedPaths, [
        path.resolve(imagePath),
        path.resolve(videoPath),
    ]);
    assert.equal(page.state.chooserCalls, 1);
    assert.equal(page.state.publishClicks, 1);

    const capturePage = createMockPage();
    const capturedPost = await publishFacebookPersonalProfileMediaPost(
        capturePage,
        {
            mediaPaths: [imagePath],
            timeout: 100,
            capturePostUrl: true,
            ...timingOptions,
        }
    );
    assert.equal(capturedPost.success, true);
    assert.equal(capturedPost.postUrlCaptured, true);
    assert.equal(
        capturedPost.postUrl,
        "https://www.facebook.com/permalink.php?story_fbid=pfbid-new&id=123"
    );
    assert.equal(capturedPost.postId, "pfbid-new");

    const privacyFailurePage = createMockPage({ applyPrivacy: false });
    const privacyFailure = await publishFacebookPersonalProfileMediaPost(
        privacyFailurePage,
        {
            mediaPaths: [imagePath],
            timeout: 100,
            ...timingOptions,
        }
    );

    assert.equal(privacyFailure.success, false);
    assert.equal(
        privacyFailure.status,
        facebookPersonalProfileMediaPostStatuses.PRIVACY_FAILED
    );
    assert.equal(privacyFailurePage.state.chooserCalls, 0);
    assert.equal(privacyFailurePage.state.publishClicks, 0);

    const invalidMedia = await publishFacebookPersonalProfileMediaPost(
        createMockPage(),
        {
            mediaPaths: [],
            timeout: 100,
            ...timingOptions,
        }
    );
    assert.equal(invalidMedia.success, false);
    assert.equal(
        invalidMedia.status,
        facebookPersonalProfileMediaPostStatuses.INVALID_INPUT
    );

    console.log("publishFacebookPersonalProfileMediaPost contract tests passed");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
