import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import changeFacebookCoverPhoto, {
    facebookCoverPhotoChangeStatuses,
} from "../facebook/actions/changeFacebookCoverPhoto.js";
import { modalDialogSelector } from "../facebook/selectors/overlays.js";
import {
    coverPhotoEditingMenuItemSelector,
    coverPhotoEditingMenuSelector,
    coverPhotoImageSelector,
    editCoverPhotoButtonSelector,
    saveCoverPhotoButtonSelector,
} from "../facebook/selectors/profile.js";


function createMockPage({
    coverUrl = "https://facebook.test/old-cover.jpg",
    openFailures = 0,
    chooserFailures = 0,
    previewNeverAppears = false,
    result = "changed",
} = {}) {
    const initialCoverUrl = coverUrl;
    const state = {
        coverUrl,
        menuVisible: false,
        previewVisible: false,
        currentTarget: null,
        editClicks: 0,
        uploadClicks: 0,
        saveClicks: 0,
        chooserCalls: 0,
        acceptedPaths: [],
        disposedHandles: 0,
    };
    const selectorVisible = (selector) => {
        if (selector === editCoverPhotoButtonSelector) {
            return !state.previewVisible;
        }
        if (selector === coverPhotoEditingMenuSelector) {
            return state.menuVisible;
        }
        if (selector === saveCoverPhotoButtonSelector) {
            return state.previewVisible && !previewNeverAppears;
        }

        return false;
    };
    const createHandle = (
        selector,
        available = true,
        text = ""
    ) => ({
        asElement() {
            return available ? this : null;
        },
        async dispose() {
            state.disposedHandles += 1;
        },
        async evaluate() {
            return text;
        },
        async boundingBox() {
            state.currentTarget = { selector, text };
            return available
                ? { x: 100, y: 150, width: 140, height: 40 }
                : null;
        },
    });

    return {
        state,
        url() {
            return "https://www.facebook.com/profile.php?id=123";
        },
        async evaluate(_callback, ...args) {
            if (args.length === 1 && args[0] === coverPhotoImageSelector) {
                return state.coverUrl;
            }
            if (
                args.length === 2
                && args[0] === modalDialogSelector
                && args[1] === coverPhotoEditingMenuSelector
            ) {
                return state.menuVisible
                    ? ["Choose cover photo Upload photo Reposition Remove"]
                    : [];
            }

            return { width: 1280, height: 900 };
        },
        async evaluateHandle(_callback, selector) {
            if (selector && typeof selector === "object") {
                if (selector.type === "selector") {
                    return createHandle(
                        selector.selector,
                        selectorVisible(selector.selector)
                    );
                }
            }

            return createHandle(selector, selectorVisible(selector));
        },
        async waitForFunction(_callback, _options, ...args) {
            if (args.length === 3) {
                if (result === "save-timeout") {
                    throw new Error("save timeout");
                }
                if (result === "unchanged") {
                    state.previewVisible = false;
                    state.coverUrl = initialCoverUrl;
                    throw new Error("cover unchanged");
                }

                state.previewVisible = false;
                state.coverUrl = "https://facebook.test/new-cover.jpg";
                return createHandle("result");
            }

            const locator = args[0];

            if (locator && typeof locator === "object" && locator.type === "selector") {
                if (!selectorVisible(locator.selector)) {
                    throw new Error(`timeout: ${locator.selector}`);
                }

                return createHandle(locator.selector);
            }

            const [selector] = args;

            if (!selectorVisible(selector)) {
                throw new Error(`timeout: ${selector}`);
            }

            return createHandle(selector);
        },
        async $$(selector) {
            if (
                selector !== coverPhotoEditingMenuItemSelector
                || !state.menuVisible
            ) {
                return [];
            }

            return [
                createHandle(selector, true, "Choose cover photo"),
                createHandle(selector, true, "UPLOAD PHOTO"),
                createHandle(selector, true, "Reposition"),
            ];
        },
        async waitForFileChooser() {
            state.chooserCalls += 1;

            if (state.chooserCalls <= chooserFailures) {
                throw new Error("file chooser timeout");
            }

            return {
                async accept(paths) {
                    state.acceptedPaths.push(...paths);
                    state.menuVisible = false;
                    state.coverUrl = null;
                    state.previewVisible = !previewNeverAppears;
                },
            };
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                const { selector, text } = state.currentTarget ?? {};

                if (selector === editCoverPhotoButtonSelector) {
                    state.editClicks += 1;
                    state.menuVisible = state.editClicks > openFailures;
                } else if (
                    selector === coverPhotoEditingMenuItemSelector
                    && text.toLocaleLowerCase() === "upload photo"
                ) {
                    state.uploadClicks += 1;
                } else if (selector === saveCoverPhotoButtonSelector) {
                    state.saveClicks += 1;
                }
            },
        },
    };
}


const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-cover-action-")
);
const imagePath = path.join(temporaryDirectory, "cover.jpg");
await writeFile(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

const timingOptions = {
    random: () => 0,
    sleep: async () => {},
};
const silentLogger = {
    info() {},
    warn() {},
    error() {},
};


try {
    const page = createMockPage();
    const entries = [];
    const result = await changeFacebookCoverPhoto(page, {
        imagePath,
        timeout: 100,
        logger: {
            child() {
                return this;
            },
            info(event, message, fields) {
                entries.push({ event, message, fields });
            },
            warn(event, message, fields) {
                entries.push({ event, message, fields });
            },
            error(event, message, fields) {
                entries.push({ event, message, fields });
            },
        },
        ...timingOptions,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, facebookCoverPhotoChangeStatuses.CHANGED);
    assert.equal(result.previousCoverUrl,
        "https://facebook.test/old-cover.jpg");
    assert.equal(result.currentCoverUrl,
        "https://facebook.test/new-cover.jpg");
    assert.equal(page.state.editClicks, 1);
    assert.equal(page.state.uploadClicks, 1);
    assert.equal(page.state.saveClicks, 1);
    assert.deepEqual(page.state.acceptedPaths, [path.resolve(imagePath)]);
    assert.equal(entries.at(-1).event, "facebook.cover_change.completed");
    assert.ok(result.diagnostics.some((entry) =>
        Number.isFinite(entry.details.x)
        && Number.isFinite(entry.details.y)
        && Number.isInteger(entry.details.steps)
    ));
    assert.equal(
        result.diagnostics.some((entry) =>
            String(entry.message ?? "").includes(
                "фінальна стабілізація оновленого профілю"
            )
        ),
        false
    );

    const openRetryPage = createMockPage({ openFailures: 1 });
    const openRetryResult = await changeFacebookCoverPhoto(
        openRetryPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(openRetryResult.success, true);
    assert.equal(openRetryPage.state.editClicks, 2);
    assert.equal(openRetryPage.state.saveClicks, 1);

    const chooserRetryPage = createMockPage({ chooserFailures: 1 });
    const chooserRetryResult = await changeFacebookCoverPhoto(
        chooserRetryPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(chooserRetryResult.success, true);
    assert.equal(chooserRetryPage.state.uploadClicks, 2);
    assert.equal(chooserRetryPage.state.chooserCalls, 2);
    assert.equal(chooserRetryPage.state.saveClicks, 1);

    const missingCoverPage = createMockPage({ coverUrl: null });
    const missingCoverResult = await changeFacebookCoverPhoto(
        missingCoverPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(missingCoverResult.success, true);
    assert.equal(missingCoverResult.previousCoverUrl, null);
    assert.equal(
        missingCoverResult.currentCoverUrl,
        "https://facebook.test/new-cover.jpg"
    );
    assert.equal(missingCoverPage.state.editClicks, 1);
    assert.equal(missingCoverPage.state.saveClicks, 1);

    const previewTimeoutPage = createMockPage({
        previewNeverAppears: true,
    });
    const previewTimeoutResult = await changeFacebookCoverPhoto(
        previewTimeoutPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        previewTimeoutResult.status,
        facebookCoverPhotoChangeStatuses.UPLOAD_FAILED
    );
    assert.equal(previewTimeoutPage.state.saveClicks, 0);

    const saveTimeoutPage = createMockPage({ result: "save-timeout" });
    const saveTimeoutResult = await changeFacebookCoverPhoto(
        saveTimeoutPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        saveTimeoutResult.status,
        facebookCoverPhotoChangeStatuses.SAVE_FAILED
    );
    assert.equal(saveTimeoutPage.state.saveClicks, 1);

    const unchangedPage = createMockPage({ result: "unchanged" });
    const unchangedResult = await changeFacebookCoverPhoto(
        unchangedPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        unchangedResult.status,
        facebookCoverPhotoChangeStatuses.VERIFICATION_FAILED
    );
    assert.equal(unchangedPage.state.saveClicks, 1);

    const invalidResult = await changeFacebookCoverPhoto(
        createMockPage(),
        {
            imagePath: path.join(temporaryDirectory, "cover.gif"),
            timeout: 100,
            logger: silentLogger,
            ...timingOptions,
        }
    );
    assert.equal(
        invalidResult.status,
        facebookCoverPhotoChangeStatuses.INVALID_IMAGE
    );

    await assert.doesNotReject(() => changeFacebookCoverPhoto(
        createMockPage(),
        {
            imagePath,
            timeout: 100,
            logger: {
                child() {
                    return this;
                },
                info() {
                    throw new Error("logger failed");
                },
                warn() {
                    throw new Error("logger failed");
                },
                error() {
                    throw new Error("logger failed");
                },
            },
            ...timingOptions,
        }
    ));
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("changeFacebookCoverPhoto contract tests passed");
