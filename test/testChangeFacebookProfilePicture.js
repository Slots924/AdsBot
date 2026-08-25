import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import changeFacebookProfilePicture, {
    facebookAvatarChangeStatuses,
} from "../facebook/actions/changeFacebookProfilePicture.js";
import { modalDialogSelector } from "../facebook/selectors/overlays.js";
import {
    chooseProfilePictureMenuItemSelector,
    chooseProfilePictureDialogSelector,
    profilePictureActionsButtonSelector,
    profilePictureImageSelector,
    saveProfilePictureButtonSelector,
    updateProfilePictureButtonSelector,
    uploadProfilePhotoButtonSelector,
} from "../facebook/selectors/profile.js";


function createMockPage({
    avatarUrl = "https://facebook.test/old-avatar.jpg",
    cameraButtonVisible = true,
    openFailures = 0,
    chooserFailures = 0,
    previewNeverAppears = false,
    result = "changed",
} = {}) {
    const state = {
        avatarUrl,
        dialogVisible: false,
        actionsMenuVisible: false,
        previewVisible: false,
        currentSelector: null,
        currentText: null,
        updateClicks: 0,
        actionsClicks: 0,
        chooseClicks: 0,
        uploadClicks: 0,
        saveClicks: 0,
        chooserCalls: 0,
        acceptedPaths: [],
        disposedHandles: 0,
    };

    const selectorVisible = (selector) => {
        if (selector === updateProfilePictureButtonSelector) {
            return Boolean(state.avatarUrl) && cameraButtonVisible;
        }
        if (selector === profilePictureActionsButtonSelector) {
            return Boolean(state.avatarUrl) && !state.dialogVisible;
        }
        if (selector === chooseProfilePictureMenuItemSelector) {
            return state.actionsMenuVisible;
        }
        if (selector === chooseProfilePictureDialogSelector) {
            return state.dialogVisible;
        }
        if (selector === uploadProfilePhotoButtonSelector) {
            return state.dialogVisible && !state.previewVisible;
        }
        if (selector === saveProfilePictureButtonSelector) {
            return state.dialogVisible
                && state.previewVisible
                && !previewNeverAppears;
        }

        return false;
    };
    const createHandle = (selector, available = true, text = "") => ({
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
            state.currentSelector = selector;
            state.currentText = text;
            return {
                x: 100,
                y: 150,
                width: 120,
                height: 40,
            };
        },
    });

    const page = {
        state,
        url() {
            return "https://www.facebook.com/profile.php?id=123";
        },
        async evaluate(_callback, selector) {
            if (selector === profilePictureImageSelector) {
                return state.avatarUrl;
            }
            if (selector === modalDialogSelector) {
                return state.dialogVisible
                    ? ["Choose profile picture"]
                    : [];
            }

            return { width: 1280, height: 900 };
        },
        async evaluateHandle(_callback, selector) {
            return createHandle(selector, selectorVisible(selector));
        },
        async waitForFunction(_callback, _options, ...args) {
            if (args.length === 3) {
                if (result === "save-timeout") {
                    throw new Error("save timeout");
                }
                if (result === "unchanged") {
                    state.dialogVisible = false;
                    throw new Error("avatar unchanged");
                }

                state.dialogVisible = false;
                state.avatarUrl = "https://facebook.test/new-avatar.jpg";
                return createHandle("result");
            }

            if (
                args[0] === chooseProfilePictureMenuItemSelector
                && String(args[1] ?? "").toLocaleLowerCase()
                    === "choose profile picture"
            ) {
                if (!state.actionsMenuVisible) {
                    throw new Error("timeout: Choose profile picture");
                }
                return createHandle(chooseProfilePictureMenuItemSelector);
            }

            const [selector] = args;

            if (!selectorVisible(selector)) {
                throw new Error(`timeout: ${selector}`);
            }

            return createHandle(selector);
        },
        async $$(selector) {
            if (
                selector !== chooseProfilePictureMenuItemSelector
                || !state.actionsMenuVisible
            ) {
                return [];
            }

            return [
                createHandle(selector, true, "View profile picture"),
                createHandle(selector, true, "CHOOSE PROFILE PICTURE"),
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
                    state.previewVisible = true;
                },
            };
        },
        mouse: {
            async move() {},
            async down() {},
            async up() {
                if (
                    state.currentSelector
                    === updateProfilePictureButtonSelector
                ) {
                    state.updateClicks += 1;
                    state.dialogVisible =
                        state.updateClicks > openFailures;
                } else if (
                    state.currentSelector
                    === profilePictureActionsButtonSelector
                ) {
                    state.actionsClicks += 1;
                    state.actionsMenuVisible = true;
                } else if (
                    state.currentSelector
                    === chooseProfilePictureMenuItemSelector
                    && String(state.currentText ?? "").toLocaleLowerCase()
                        === "choose profile picture"
                ) {
                    state.chooseClicks += 1;
                    state.actionsMenuVisible = false;
                    state.dialogVisible = true;
                } else if (
                    state.currentSelector
                    === uploadProfilePhotoButtonSelector
                ) {
                    state.uploadClicks += 1;
                } else if (
                    state.currentSelector
                    === saveProfilePictureButtonSelector
                ) {
                    state.saveClicks += 1;
                }
            },
        },
    };

    return page;
}


const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-avatar-action-")
);
const imagePath = path.join(temporaryDirectory, "avatar.jpg");
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
    const result = await changeFacebookProfilePicture(page, {
        imagePath,
        timeout: 100,
        logger: {
            child() {
                return this;
            },
            info(event, message, fields) {
                entries.push({ level: "info", event, message, fields });
            },
            warn(event, message, fields) {
                entries.push({ level: "warn", event, message, fields });
            },
            error(event, message, fields) {
                entries.push({ level: "error", event, message, fields });
            },
        },
        ...timingOptions,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, facebookAvatarChangeStatuses.CHANGED);
    assert.equal(result.previousAvatarUrl,
        "https://facebook.test/old-avatar.jpg");
    assert.equal(result.currentAvatarUrl,
        "https://facebook.test/new-avatar.jpg");
    assert.equal(result.failedSelector, null);
    assert.equal(page.state.updateClicks, 1);
    assert.equal(page.state.uploadClicks, 1);
    assert.equal(page.state.saveClicks, 1);
    assert.deepEqual(page.state.acceptedPaths, [path.resolve(imagePath)]);
    assert.ok(result.diagnostics.length > 0);
    assert.equal(entries.at(-1).event,
        "facebook.avatar_change.completed");
    assert.ok(result.diagnostics.some((entry) =>
        Number.isFinite(entry.details.x)
        && Number.isFinite(entry.details.y)
        && Number.isInteger(entry.details.steps)
    ));

    const menuFallbackPage = createMockPage({
        cameraButtonVisible: false,
    });
    const menuFallbackResult = await changeFacebookProfilePicture(
        menuFallbackPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(menuFallbackResult.success, true);
    assert.equal(menuFallbackPage.state.updateClicks, 0);
    assert.equal(menuFallbackPage.state.actionsClicks, 1);
    assert.equal(menuFallbackPage.state.chooseClicks, 1);
    assert.equal(menuFallbackPage.state.saveClicks, 1);

    const openRetryPage = createMockPage({ openFailures: 1 });
    const openRetryResult = await changeFacebookProfilePicture(
        openRetryPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(openRetryResult.success, true);
    assert.equal(openRetryPage.state.updateClicks, 2);
    assert.equal(openRetryPage.state.saveClicks, 1);

    const chooserRetryPage = createMockPage({ chooserFailures: 1 });
    const chooserRetryResult = await changeFacebookProfilePicture(
        chooserRetryPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(chooserRetryResult.success, true);
    assert.equal(chooserRetryPage.state.uploadClicks, 2);
    assert.equal(chooserRetryPage.state.chooserCalls, 2);
    assert.equal(chooserRetryPage.state.saveClicks, 1);

    const missingAvatarPage = createMockPage({ avatarUrl: null });
    const missingAvatarResult = await changeFacebookProfilePicture(
        missingAvatarPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        missingAvatarResult.status,
        facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND
    );
    assert.equal(
        missingAvatarResult.failedSelector,
        profilePictureImageSelector
    );

    const dialogTimeoutPage = createMockPage({ openFailures: 2 });
    const dialogTimeoutResult = await changeFacebookProfilePicture(
        dialogTimeoutPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        dialogTimeoutResult.status,
        facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND
    );
    assert.equal(dialogTimeoutPage.state.updateClicks, 2);

    const previewTimeoutPage = createMockPage({
        previewNeverAppears: true,
    });
    const previewTimeoutResult = await changeFacebookProfilePicture(
        previewTimeoutPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        previewTimeoutResult.status,
        facebookAvatarChangeStatuses.UPLOAD_FAILED
    );
    assert.equal(previewTimeoutPage.state.saveClicks, 0);

    const saveTimeoutPage = createMockPage({ result: "save-timeout" });
    const saveTimeoutResult = await changeFacebookProfilePicture(
        saveTimeoutPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        saveTimeoutResult.status,
        facebookAvatarChangeStatuses.SAVE_FAILED
    );
    assert.equal(saveTimeoutPage.state.saveClicks, 1);

    const unchangedPage = createMockPage({ result: "unchanged" });
    const unchangedResult = await changeFacebookProfilePicture(
        unchangedPage,
        { imagePath, timeout: 100, logger: silentLogger, ...timingOptions }
    );
    assert.equal(
        unchangedResult.status,
        facebookAvatarChangeStatuses.VERIFICATION_FAILED
    );
    assert.equal(unchangedPage.state.saveClicks, 1);

    const invalidImagePage = createMockPage();
    const invalidImageResult = await changeFacebookProfilePicture(
        invalidImagePage,
        {
            imagePath: path.join(temporaryDirectory, "avatar.gif"),
            timeout: 100,
            logger: silentLogger,
            ...timingOptions,
        }
    );
    assert.equal(
        invalidImageResult.status,
        facebookAvatarChangeStatuses.INVALID_IMAGE
    );
    assert.equal(invalidImagePage.state.updateClicks, 0);

    const brokenLoggerPage = createMockPage();
    await assert.doesNotReject(() => changeFacebookProfilePicture(
        brokenLoggerPage,
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

console.log("changeFacebookProfilePicture contract tests passed");
