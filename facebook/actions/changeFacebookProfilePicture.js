import path from "node:path";

import loadImageFromPath from "../../services/images/loadImageFromPath.js";
import {
    clickUntilConfirmed,
    describeLocator,
} from "../browser/confirmedClick.js";
import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import { modalDialogSelector } from "../selectors/overlays.js";
import {
    chooseProfilePictureMenuItemSelector,
    chooseProfilePictureDialogSelector,
    profilePictureActionsButtonSelector,
    profilePictureImageSelector,
    profilePictureUploadInputSelector,
    saveProfilePictureButtonSelector,
    updateProfilePictureButtonSelector,
    uploadProfilePhotoButtonSelector,
} from "../selectors/profile.js";


const fileChooserTimeout = 15000;
const chooseProfilePictureMenuText = "Choose profile picture";

export const facebookAvatarChangeStatuses = Object.freeze({
    CHANGED: "CHANGED",
    INVALID_IMAGE: "INVALID_IMAGE",
    ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
    UPLOAD_FAILED: "UPLOAD_FAILED",
    SAVE_FAILED: "SAVE_FAILED",
    VERIFICATION_FAILED: "VERIFICATION_FAILED",
    ERROR: "ERROR",
});


class FacebookAvatarChangeError extends Error {
    constructor(message, {
        code = "FACEBOOK_AVATAR_CHANGE_FAILED",
        status = facebookAvatarChangeStatuses.ERROR,
        stage = null,
        selector = null,
        timeoutMs = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookAvatarChangeError";
        this.code = code;
        this.status = status;
        this.stage = stage;
        this.selector = selector;
        this.timeoutMs = timeoutMs;
    }
}


function emitLog(logger, level, event, message, fields = {}) {
    const method = logger?.[level];

    if (typeof method !== "function") {
        return;
    }

    try {
        if (typeof logger.child === "function") {
            method.call(logger, event, message, fields);
            return;
        }

        method.call(
            logger,
            `[changeFacebookProfilePicture] [${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


function createErrorDetails(error, fallback = {}) {
    return {
        code: error?.code ?? fallback.code
            ?? "FACEBOOK_AVATAR_CHANGE_FAILED",
        message: error?.message ?? String(error),
        stage: error?.stage ?? fallback.stage ?? null,
        selector: error?.selector ?? fallback.selector ?? null,
        timeoutMs: error?.timeoutMs ?? fallback.timeoutMs ?? null,
        name: error?.name ?? "Error",
        stack: error?.stack ?? null,
    };
}


async function readAvatarUrl(page) {
    return page.evaluate((selector) => {
        const avatar = document.querySelector(selector);

        return avatar?.getAttribute("href")
            ?? avatar?.getAttribute("xlink:href")
            ?? null;
    }, profilePictureImageSelector);
}


async function readVisibleDialogs(page) {
    return page.evaluate((selector) => {
        return Array.from(document.querySelectorAll(selector))
            .filter((element) => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            })
            .map((element) => String(element.innerText ?? "")
                .replace(/\s+/g, " ")
                .trim())
            .filter(Boolean);
    }, modalDialogSelector);
}


async function isVisible(page, selector) {
    const element = await getFirstVisibleElement(page, selector);

    if (!element) {
        return false;
    }

    await element.dispose().catch(() => {});
    return true;
}


async function waitForVisible(
    page,
    selector,
    timeout,
    stage
) {
    try {
        return await waitForVisibleElement(page, selector, { timeout });
    } catch (error) {
        throw new FacebookAvatarChangeError(
            `Не знайдено видимий елемент: ${selector}`,
            {
                code: "FACEBOOK_AVATAR_SELECTOR_TIMEOUT",
                status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                stage,
                selector,
                timeoutMs: timeout,
                cause: error,
            }
        );
    }
}


async function pauseAfterVisible(
    preset,
    report,
    stage,
    reason,
    timingOptions
) {
    await waitHuman(preset, {
        ...timingOptions,
        onDelay: (delayMs) => report(
            stage,
            `Пауза ${delayMs} мс: ${reason}`,
            { delayMs, reason }
        ),
    });
}


async function findVisibleElementByText(page, selector, expectedText) {
    const elements = await page.$$(selector);
    let matchedElement = null;
    const normalizedExpectedText = expectedText.toLocaleLowerCase();

    for (const element of elements) {
        try {
            const text = await element.evaluate((node) =>
                String(node.textContent ?? "").replace(/\s+/g, " ").trim()
            );
            const rectangle = await element.boundingBox();

            if (
                text.toLocaleLowerCase() === normalizedExpectedText
                && rectangle
            ) {
                matchedElement = element;
                break;
            }
        } catch {
            // React міг замінити menuitem під час перевірки.
        }
    }

    await Promise.all(elements
        .filter((element) => element !== matchedElement)
        .map((element) => element.dispose().catch(() => {})));

    return matchedElement;
}


async function clickChooseProfilePictureMenuItem(
    page,
    {
        timeout,
        report,
        stage,
        timingOptions,
        attempt,
    }
) {
    try {
        await page.waitForFunction(
            (selector, expectedText) => {
                const expected = String(expectedText ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase();
                return Array.from(document.querySelectorAll(selector))
                    .some((node) => {
                        const rectangle = node.getBoundingClientRect();
                        const style = window.getComputedStyle(node);
                        const text = String(node.textContent ?? "")
                            .replace(/\s+/g, " ")
                            .trim()
                            .toLocaleLowerCase();
                        return text === expected
                            && rectangle.width > 0
                            && rectangle.height > 0
                            && style.display !== "none"
                            && style.visibility !== "hidden"
                            && style.opacity !== "0";
                    });
            },
            { timeout },
            chooseProfilePictureMenuItemSelector,
            chooseProfilePictureMenuText
        );
    } catch (error) {
        throw new FacebookAvatarChangeError(
            "Не знайдено пункт меню «Choose profile picture»",
            {
                code: "FACEBOOK_AVATAR_MENU_ITEM_NOT_FOUND",
                status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                stage,
                selector: chooseProfilePictureMenuItemSelector,
                timeoutMs: timeout,
                cause: error,
            }
        );
    }

    let element = await findVisibleElementByText(
        page,
        chooseProfilePictureMenuItemSelector,
        chooseProfilePictureMenuText
    );

    if (!element) {
        throw new FacebookAvatarChangeError(
            "Не знайдено пункт меню «Choose profile picture»",
            {
                code: "FACEBOOK_AVATAR_MENU_ITEM_NOT_FOUND",
                status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                stage,
                selector: chooseProfilePictureMenuItemSelector,
                timeoutMs: timeout,
            }
        );
    }

    await element.dispose().catch(() => {});
    await pauseAfterVisible(
        "medium",
        report,
        stage,
        "стабілізація React для menuitem «Choose profile picture»",
        timingOptions
    );
    element = await findVisibleElementByText(
        page,
        chooseProfilePictureMenuItemSelector,
        chooseProfilePictureMenuText
    );

    if (!element) {
        throw new FacebookAvatarChangeError(
            "Пункт меню «Choose profile picture» зник після React rerender",
            {
                code: "FACEBOOK_AVATAR_MENU_ITEM_DETACHED",
                status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                stage,
                selector: chooseProfilePictureMenuItemSelector,
                timeoutMs: timeout,
            }
        );
    }

    try {
        await humanClickElement(page, element, {
            beforeDelay: [100, 260],
            holdDelay: [80, 170],
            scrollDelay: [900, 1600],
            random: timingOptions.random,
            ...(timingOptions.sleep
                ? { sleep: timingOptions.sleep }
                : {}),
            onEvent: (event) => report(
                stage,
                "Pointer event «Choose profile picture»: "
                + event.type,
                {
                    ...event,
                    selector: chooseProfilePictureMenuItemSelector,
                    attempt,
                }
            ),
        });
    } catch (error) {
        throw new FacebookAvatarChangeError(
            `Не вдалося клікнути «Choose profile picture»: ${error.message}`,
            {
                code: "FACEBOOK_AVATAR_INTERACTION_FAILED",
                status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                stage,
                selector: chooseProfilePictureMenuItemSelector,
                timeoutMs: timeout,
                cause: error,
            }
        );
    } finally {
        await element.dispose().catch(() => {});
    }
}


async function clickFreshVisibleElement(
    page,
    selector,
    {
        timeout,
        report,
        stage,
        description,
        stabilization = "long",
        beforeDelay = [100, 260],
        timingOptions,
        attempt = 1,
    }
) {
    report(stage, `Чекаємо елемент «${description}»`, {
        selector,
        timeout,
        attempt,
    });

    const initialElement = await waitForVisible(
        page,
        selector,
        timeout,
        stage
    );
    await initialElement.dispose().catch(() => {});
    await pauseAfterVisible(
        stabilization,
        report,
        stage,
        `стабілізація React для «${description}»`,
        timingOptions
    );

    const element = await waitForVisible(
        page,
        selector,
        timeout,
        stage
    );

    try {
        await humanClickElement(page, element, {
            beforeDelay,
            holdDelay: [80, 170],
            scrollDelay: [900, 1600],
            random: timingOptions.random,
            ...(timingOptions.sleep
                ? { sleep: timingOptions.sleep }
                : {}),
            onEvent: (event) => report(
                stage,
                `Pointer event «${description}»: ${event.type}`,
                {
                    ...event,
                    selector,
                    attempt,
                }
            ),
        });
    } catch (error) {
        throw new FacebookAvatarChangeError(
            `Не вдалося клікнути «${description}»: ${error.message}`,
            {
                code: "FACEBOOK_AVATAR_INTERACTION_FAILED",
                status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                stage,
                selector,
                timeoutMs: timeout,
                cause: error,
            }
        );
    } finally {
        await element.dispose().catch(() => {});
    }
}


async function clickUntilNextVisible(
    page,
    options,
    { timeout, report, stage, timingOptions }
) {
    const selector = describeLocator(options.target);

    try {
        return await clickUntilConfirmed(page, {
            ...options,
            timeout,
            confirmTimeout: timeout,
            clickOptions: {
                random: timingOptions.random,
                ...(timingOptions.sleep
                    ? { sleep: timingOptions.sleep }
                    : {}),
                onEvent: (event) => report(
                    stage,
                    `Pointer event «${options.description}»: ${event.type}`,
                    {
                        ...event,
                        selector,
                    }
                ),
            },
            onStep: (message, details) => report(stage, message, details),
        });
    } catch (error) {
        throw new FacebookAvatarChangeError(error.message, {
            code: error?.code === "BROWSER_CLICK_NOT_CONFIRMED"
                ? "FACEBOOK_AVATAR_INTERACTION_FAILED"
                : "FACEBOOK_AVATAR_SELECTOR_TIMEOUT",
            status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
            stage,
            selector: error?.selector ?? selector,
            timeoutMs: error?.timeoutMs ?? timeout,
            cause: error,
        });
    }
}


async function openPictureDialog(
    page,
    { timeout, report, timingOptions }
) {
    const stage = "OPEN_PICTURE_DIALOG";

    if (await isVisible(page, chooseProfilePictureDialogSelector)) {
        return;
    }

    if (await isVisible(page, updateProfilePictureButtonSelector)) {
        await clickUntilNextVisible(
            page,
            {
                target: {
                    selector: updateProfilePictureButtonSelector,
                },
                confirm: {
                    selector: chooseProfilePictureDialogSelector,
                },
                description: "Update profile picture",
            },
            {
                timeout,
                report,
                stage,
                timingOptions,
            }
        );
        return;
    }

    report(
        stage,
        "Кнопки камери немає, відкриваємо меню поточної аватарки",
        {
            selector: profilePictureActionsButtonSelector,
        }
    );
    await clickUntilNextVisible(
        page,
        {
            target: {
                selector: profilePictureActionsButtonSelector,
            },
            confirm: {
                candidateSelector: chooseProfilePictureMenuItemSelector,
                expectedText: chooseProfilePictureMenuText,
            },
            description: "Profile picture actions",
        },
        {
            timeout,
            report,
            stage,
            timingOptions,
        }
    );
    await clickChooseProfilePictureMenuItem(page, {
        timeout,
        report,
        stage,
        timingOptions,
        attempt: 1,
    });

    const dialog = await waitForVisible(
        page,
        chooseProfilePictureDialogSelector,
        timeout,
        stage
    );
    await dialog.dispose().catch(() => {});
}


async function uploadPicture(
    page,
    absolutePath,
    { timeout, report, timingOptions }
) {
    const stage = "UPLOAD_PHOTO";
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (await isVisible(page, saveProfilePictureButtonSelector)) {
            return;
        }

        try {
            const chooserPromise = page.waitForFileChooser({
                timeout: fileChooserTimeout,
            });
            const clickPromise = clickFreshVisibleElement(
                page,
                uploadProfilePhotoButtonSelector,
                {
                    timeout,
                    report,
                    stage,
                    description: "Upload Photo",
                    stabilization: "medium",
                    timingOptions,
                    attempt,
                }
            );
            const [chooserResult, clickResult] = await Promise.allSettled([
                chooserPromise,
                clickPromise,
            ]);

            if (clickResult.status === "rejected") {
                throw clickResult.reason;
            }

            if (chooserResult.status === "rejected") {
                throw chooserResult.reason;
            }

            const fileChooser = chooserResult.value;

            report(stage, "Передаємо файл у Facebook file chooser", {
                attempt,
                selector: profilePictureUploadInputSelector,
                filename: path.basename(absolutePath),
            });
            await fileChooser.accept([absolutePath]);

            let preview;

            try {
                preview = await waitForVisibleElement(
                    page,
                    saveProfilePictureButtonSelector,
                    { timeout }
                );
            } catch (error) {
                throw new FacebookAvatarChangeError(
                    "Facebook не показав preview завантаженої аватарки",
                    {
                        code: "FACEBOOK_AVATAR_PREVIEW_TIMEOUT",
                        status: facebookAvatarChangeStatuses.UPLOAD_FAILED,
                        stage: "WAIT_PREVIEW",
                        selector: saveProfilePictureButtonSelector,
                        timeoutMs: timeout,
                        cause: error,
                    }
                );
            } finally {
                await preview?.dispose().catch(() => {});
            }

            return;
        } catch (error) {
            lastError = error instanceof FacebookAvatarChangeError
                ? error
                : new FacebookAvatarChangeError(
                    `Не вдалося відкрити file chooser: ${error.message}`,
                    {
                        code: "FACEBOOK_AVATAR_FILE_CHOOSER_FAILED",
                        status: facebookAvatarChangeStatuses.UPLOAD_FAILED,
                        stage,
                        selector: uploadProfilePhotoButtonSelector,
                        timeoutMs: fileChooserTimeout,
                        cause: error,
                    }
                );

            if (
                lastError.code === "FACEBOOK_AVATAR_PREVIEW_TIMEOUT"
                || attempt === 2
            ) {
                break;
            }

            report(
                stage,
                "File chooser не відкрився, перевіряємо preview перед retry",
                {
                    attempt,
                    selector: uploadProfilePhotoButtonSelector,
                    error: createErrorDetails(lastError),
                },
                { level: "warn" }
            );
        }
    }

    throw lastError;
}


export default async function changeFacebookProfilePicture(
    page,
    {
        imagePath,
        logger = console,
        timeout = 90000,
        random = Math.random,
        sleep,
    } = {}
) {
    const startedAt = new Date().toISOString();
    const diagnostics = [];
    const timingOptions = {
        random,
        ...(sleep ? { sleep } : {}),
    };
    let stage = "VALIDATE_INPUT";
    let previousAvatarUrl = null;
    let currentAvatarUrl = null;

    const report = (
        currentStage,
        message,
        details = {},
        {
            level = "info",
            event = "facebook.avatar_change.step",
        } = {}
    ) => {
        const fields = {
            stage: currentStage,
            url: page.url(),
            ...details,
        };
        const entry = {
            at: new Date().toISOString(),
            level,
            event,
            stage: currentStage,
            message,
            details: fields,
        };

        diagnostics.push(entry);
        emitLog(logger, level, event, message, fields);
    };
    const finish = (status, extra = {}) => {
        const success = status === facebookAvatarChangeStatuses.CHANGED;
        const level = success ? "info" : "error";

        report(
            stage,
            `Зміна аватарки завершена зі статусом ${status}`,
            {
                status,
                success,
                previousAvatarUrl,
                currentAvatarUrl,
                error: extra.error ?? null,
            },
            {
                level,
                event: "facebook.avatar_change.completed",
            }
        );

        return {
            success,
            status,
            stage,
            previousAvatarUrl,
            currentAvatarUrl,
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: page.url(),
            failedSelector: extra.error?.selector ?? null,
            error: extra.error ?? null,
            diagnostics,
            ...extra,
        };
    };

    try {
        if (!Number.isFinite(timeout) || timeout <= 0) {
            throw new FacebookAvatarChangeError(
                "Timeout зміни аватарки має бути додатним числом",
                {
                    code: "FACEBOOK_AVATAR_INVALID_TIMEOUT",
                    status: facebookAvatarChangeStatuses.ERROR,
                    stage,
                }
            );
        }

        let image;

        try {
            image = await loadImageFromPath(imagePath);
        } catch (error) {
            throw new FacebookAvatarChangeError(error.message, {
                code: "FACEBOOK_AVATAR_INVALID_IMAGE",
                status: facebookAvatarChangeStatuses.INVALID_IMAGE,
                stage,
                cause: error,
            });
        }

        const absolutePath = path.resolve(String(imagePath).trim());
        report(stage, "Файл аватарки перевірено", {
            filename: image.filename,
            contentType: image.contentType,
            bytes: image.buffer.length,
        });

        stage = "READ_CURRENT_AVATAR";
        previousAvatarUrl = await readAvatarUrl(page);

        if (!previousAvatarUrl) {
            throw new FacebookAvatarChangeError(
                "Не знайдено поточну аватарку профілю",
                {
                    code: "FACEBOOK_AVATAR_CURRENT_IMAGE_NOT_FOUND",
                    status: facebookAvatarChangeStatuses.ELEMENT_NOT_FOUND,
                    stage,
                    selector: profilePictureImageSelector,
                    timeoutMs: timeout,
                }
            );
        }

        report(stage, "Збережено URL поточної аватарки", {
            selector: profilePictureImageSelector,
            previousAvatarUrl,
        });

        stage = "OPEN_PICTURE_DIALOG";
        await openPictureDialog(page, {
            timeout,
            report,
            timingOptions,
        });

        stage = "WAIT_CHOOSER_DIALOG";
        await pauseAfterVisible(
            "long",
            report,
            stage,
            "повне завантаження діалогу Choose profile picture",
            timingOptions
        );

        stage = "UPLOAD_PHOTO";
        await uploadPicture(page, absolutePath, {
            timeout,
            report,
            timingOptions,
        });

        stage = "WAIT_PREVIEW";
        await pauseAfterVisible(
            "veryLong",
            report,
            stage,
            "завантаження preview і скриптів crop",
            timingOptions
        );

        stage = "SAVE";
        await clickFreshVisibleElement(
            page,
            saveProfilePictureButtonSelector,
            {
                timeout,
                report,
                stage,
                description: "Save",
                stabilization: "medium",
                beforeDelay: [1500, 3000],
                timingOptions,
                attempt: 1,
            }
        );

        stage = "WAIT_RESULT";
        let resultHandle;

        try {
            resultHandle = await page.waitForFunction(
                (dialogSelector, avatarSelector, oldUrl) => {
                    const dialog = document.querySelector(dialogSelector);
                    const avatar = document.querySelector(avatarSelector);
                    const newUrl = avatar?.getAttribute("href")
                        ?? avatar?.getAttribute("xlink:href")
                        ?? null;

                    return !dialog && Boolean(newUrl) && newUrl !== oldUrl;
                },
                { timeout },
                chooseProfilePictureDialogSelector,
                profilePictureImageSelector,
                previousAvatarUrl
            );
        } catch (error) {
            currentAvatarUrl = await readAvatarUrl(page).catch(() => null);
            const dialogs = await readVisibleDialogs(page).catch(() => []);
            const dialogStillVisible = await isVisible(
                page,
                chooseProfilePictureDialogSelector
            ).catch(() => false);

            throw new FacebookAvatarChangeError(
                dialogStillVisible
                    ? "Facebook не завершив збереження аватарки"
                    : "Facebook закрив діалог, але URL аватарки не змінився",
                {
                    code: dialogStillVisible
                        ? "FACEBOOK_AVATAR_SAVE_TIMEOUT"
                        : "FACEBOOK_AVATAR_NOT_CHANGED",
                    status: dialogStillVisible
                        ? facebookAvatarChangeStatuses.SAVE_FAILED
                        : facebookAvatarChangeStatuses.VERIFICATION_FAILED,
                    stage,
                    selector: dialogStillVisible
                        ? chooseProfilePictureDialogSelector
                        : profilePictureImageSelector,
                    timeoutMs: timeout,
                    cause: error,
                    dialogs,
                }
            );
        } finally {
            await resultHandle?.dispose().catch(() => {});
        }

        stage = "VERIFY_AVATAR";
        currentAvatarUrl = await readAvatarUrl(page);

        if (
            !currentAvatarUrl
            || currentAvatarUrl === previousAvatarUrl
        ) {
            throw new FacebookAvatarChangeError(
                "URL аватарки не змінився після збереження",
                {
                    code: "FACEBOOK_AVATAR_NOT_CHANGED",
                    status:
                        facebookAvatarChangeStatuses.VERIFICATION_FAILED,
                    stage,
                    selector: profilePictureImageSelector,
                    timeoutMs: timeout,
                }
            );
        }

        return finish(facebookAvatarChangeStatuses.CHANGED);
    } catch (error) {
        const normalizedError = error instanceof FacebookAvatarChangeError
            ? error
            : new FacebookAvatarChangeError(
                error?.message ?? String(error),
                {
                    code: error?.code,
                    status: facebookAvatarChangeStatuses.ERROR,
                    stage,
                    cause: error,
                }
            );
        stage = normalizedError.stage ?? stage;
        const errorDetails = createErrorDetails(normalizedError, { stage });
        const dialogs = await readVisibleDialogs(page).catch(() => []);

        report(
            stage,
            `Помилка зміни аватарки: ${errorDetails.message}`,
            {
                ...errorDetails,
                dialogs,
            },
            {
                level: "error",
                event: "facebook.avatar_change.failed",
            }
        );

        return finish(normalizedError.status, {
            error: errorDetails,
            dialogText: dialogs.join(" "),
        });
    }
}


export {
    chooseProfilePictureDialogSelector,
    profilePictureImageSelector,
    profilePictureUploadInputSelector,
    saveProfilePictureButtonSelector,
    updateProfilePictureButtonSelector,
    uploadProfilePhotoButtonSelector,
};
