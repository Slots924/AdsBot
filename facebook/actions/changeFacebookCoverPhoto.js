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
    coverPhotoEditingMenuItemSelector,
    coverPhotoEditingMenuSelector,
    coverPhotoImageSelector,
    coverPhotoUploadInputSelector,
    editCoverPhotoButtonSelector,
    saveCoverPhotoButtonSelector,
} from "../selectors/profile.js";


const fileChooserTimeout = 15000;
const uploadPhotoMenuText = "Upload photo";

export const facebookCoverPhotoChangeStatuses = Object.freeze({
    CHANGED: "CHANGED",
    INVALID_IMAGE: "INVALID_IMAGE",
    ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
    UPLOAD_FAILED: "UPLOAD_FAILED",
    SAVE_FAILED: "SAVE_FAILED",
    VERIFICATION_FAILED: "VERIFICATION_FAILED",
    ERROR: "ERROR",
});


class FacebookCoverPhotoChangeError extends Error {
    constructor(message, {
        code = "FACEBOOK_COVER_CHANGE_FAILED",
        status = facebookCoverPhotoChangeStatuses.ERROR,
        stage = null,
        selector = null,
        timeoutMs = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookCoverPhotoChangeError";
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
            `[changeFacebookCoverPhoto] [${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


function createErrorDetails(error, fallback = {}) {
    return {
        code: error?.code ?? fallback.code
            ?? "FACEBOOK_COVER_CHANGE_FAILED",
        message: error?.message ?? String(error),
        stage: error?.stage ?? fallback.stage ?? null,
        selector: error?.selector ?? fallback.selector ?? null,
        timeoutMs: error?.timeoutMs ?? fallback.timeoutMs ?? null,
        name: error?.name ?? "Error",
        stack: error?.stack ?? null,
    };
}


async function readCoverUrl(page) {
    return page.evaluate((selector) => {
        const cover = document.querySelector(selector);

        return (
            cover?.currentSrc
            || cover?.getAttribute("src")
        ) ?? null;
    }, coverPhotoImageSelector);
}


async function readVisibleLayers(page) {
    return page.evaluate((dialogSelector, menuSelector) => {
        const selectors = `${dialogSelector}, ${menuSelector}`;

        return Array.from(document.querySelectorAll(selectors))
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
    }, modalDialogSelector, coverPhotoEditingMenuSelector);
}


async function isVisible(page, selector) {
    const element = await getFirstVisibleElement(page, selector);

    if (!element) {
        return false;
    }

    await element.dispose().catch(() => {});
    return true;
}


async function waitForVisible(page, selector, timeout, stage) {
    try {
        return await waitForVisibleElement(page, selector, { timeout });
    } catch (error) {
        throw new FacebookCoverPhotoChangeError(
            `Не знайдено видимий елемент: ${selector}`,
            {
                code: "FACEBOOK_COVER_SELECTOR_TIMEOUT",
                status: facebookCoverPhotoChangeStatuses.ELEMENT_NOT_FOUND,
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
        throw new FacebookCoverPhotoChangeError(
            `Не вдалося клікнути «${description}»: ${error.message}`,
            {
                code: "FACEBOOK_COVER_INTERACTION_FAILED",
                status: facebookCoverPhotoChangeStatuses.ELEMENT_NOT_FOUND,
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


async function findVisibleElementByText(page, selector, expectedText) {
    const elements = await page.$$(selector);
    let matchedElement = null;
    const normalizedExpectedText = expectedText.toLocaleLowerCase();

    for (const element of elements) {
        try {
            const text = await element.evaluate((node) =>
                String(node.innerText ?? "").replace(/\s+/g, " ").trim()
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


async function clickFreshMenuItem(
    page,
    expectedText,
    {
        timeout,
        report,
        stage,
        timingOptions,
        attempt,
    }
) {
    let element = await findVisibleElementByText(
        page,
        coverPhotoEditingMenuItemSelector,
        expectedText
    );

    if (!element) {
        throw new FacebookCoverPhotoChangeError(
            `Не знайдено пункт меню «${expectedText}»`,
            {
                code: "FACEBOOK_COVER_MENU_ITEM_NOT_FOUND",
                status: facebookCoverPhotoChangeStatuses.UPLOAD_FAILED,
                stage,
                selector: coverPhotoEditingMenuItemSelector,
                timeoutMs: timeout,
            }
        );
    }

    await element.dispose().catch(() => {});
    await pauseAfterVisible(
        "medium",
        report,
        stage,
        `стабілізація React для menuitem «${expectedText}»`,
        timingOptions
    );
    element = await findVisibleElementByText(
        page,
        coverPhotoEditingMenuItemSelector,
        expectedText
    );

    if (!element) {
        throw new FacebookCoverPhotoChangeError(
            `Пункт меню «${expectedText}» зник після React rerender`,
            {
                code: "FACEBOOK_COVER_MENU_ITEM_DETACHED",
                status: facebookCoverPhotoChangeStatuses.UPLOAD_FAILED,
                stage,
                selector: coverPhotoEditingMenuItemSelector,
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
                `Pointer event «${expectedText}»: ${event.type}`,
                {
                    ...event,
                    selector: coverPhotoEditingMenuItemSelector,
                    expectedText,
                    attempt,
                }
            ),
        });
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
        throw new FacebookCoverPhotoChangeError(error.message, {
            code: error?.code === "BROWSER_CLICK_NOT_CONFIRMED"
                ? "FACEBOOK_COVER_INTERACTION_FAILED"
                : "FACEBOOK_COVER_SELECTOR_TIMEOUT",
            status: facebookCoverPhotoChangeStatuses.ELEMENT_NOT_FOUND,
            stage,
            selector: error?.selector ?? selector,
            timeoutMs: error?.timeoutMs ?? timeout,
            cause: error,
        });
    }
}


async function openCoverEditingMenu(
    page,
    { timeout, report, timingOptions }
) {
    const stage = "OPEN_COVER_MENU";

    if (await isVisible(page, coverPhotoEditingMenuSelector)) {
        return;
    }

    await clickUntilNextVisible(
        page,
        {
            target: {
                selector: editCoverPhotoButtonSelector,
            },
            confirm: {
                selector: coverPhotoEditingMenuSelector,
            },
            description: "Edit cover photo",
        },
        {
            timeout,
            report,
            stage,
            timingOptions,
        }
    );
}


async function uploadCoverPhoto(
    page,
    absolutePath,
    { timeout, report, timingOptions }
) {
    const stage = "UPLOAD_COVER";
    let lastError;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (await isVisible(page, saveCoverPhotoButtonSelector)) {
            return;
        }

        try {
            if (!await isVisible(page, coverPhotoEditingMenuSelector)) {
                await openCoverEditingMenu(page, {
                    timeout,
                    report,
                    timingOptions,
                });
                await pauseAfterVisible(
                    "long",
                    report,
                    stage,
                    "повне завантаження меню редагування шпалер",
                    timingOptions
                );
            }

            const chooserPromise = page.waitForFileChooser({
                timeout: fileChooserTimeout,
            });
            const clickPromise = clickFreshMenuItem(
                page,
                uploadPhotoMenuText,
                {
                    timeout,
                    report,
                    stage,
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

            report(stage, "Передаємо файл у Facebook file chooser", {
                attempt,
                selector: coverPhotoUploadInputSelector,
                filename: path.basename(absolutePath),
            });
            await chooserResult.value.accept([absolutePath]);

            let preview;

            try {
                preview = await waitForVisibleElement(
                    page,
                    saveCoverPhotoButtonSelector,
                    { timeout }
                );
            } catch (error) {
                throw new FacebookCoverPhotoChangeError(
                    "Facebook не показав preview нових шпалер",
                    {
                        code: "FACEBOOK_COVER_PREVIEW_TIMEOUT",
                        status: facebookCoverPhotoChangeStatuses.UPLOAD_FAILED,
                        stage: "WAIT_PREVIEW",
                        selector: saveCoverPhotoButtonSelector,
                        timeoutMs: timeout,
                        cause: error,
                    }
                );
            } finally {
                await preview?.dispose().catch(() => {});
            }

            return;
        } catch (error) {
            lastError = error instanceof FacebookCoverPhotoChangeError
                ? error
                : new FacebookCoverPhotoChangeError(
                    `Не вдалося відкрити file chooser: ${error.message}`,
                    {
                        code: "FACEBOOK_COVER_FILE_CHOOSER_FAILED",
                        status: facebookCoverPhotoChangeStatuses.UPLOAD_FAILED,
                        stage,
                        selector: coverPhotoEditingMenuItemSelector,
                        timeoutMs: fileChooserTimeout,
                        cause: error,
                    }
                );

            if (
                lastError.code === "FACEBOOK_COVER_PREVIEW_TIMEOUT"
                || attempt === 2
            ) {
                break;
            }

            report(
                stage,
                "File chooser не відкрився, перевіряємо preview перед retry",
                {
                    attempt,
                    selector: coverPhotoEditingMenuItemSelector,
                    error: createErrorDetails(lastError),
                },
                { level: "warn" }
            );
        }
    }

    throw lastError;
}


export default async function changeFacebookCoverPhoto(
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
    let previousCoverUrl = null;
    let currentCoverUrl = null;

    const report = (
        currentStage,
        message,
        details = {},
        {
            level = "info",
            event = "facebook.cover_change.step",
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
        const success = status === facebookCoverPhotoChangeStatuses.CHANGED;

        report(
            stage,
            `Зміна шпалер завершена зі статусом ${status}`,
            {
                status,
                success,
                previousCoverUrl,
                currentCoverUrl,
                error: extra.error ?? null,
            },
            {
                level: success ? "info" : "error",
                event: "facebook.cover_change.completed",
            }
        );

        return {
            success,
            status,
            stage,
            previousCoverUrl,
            currentCoverUrl,
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
            throw new FacebookCoverPhotoChangeError(
                "Timeout зміни шпалер має бути додатним числом",
                {
                    code: "FACEBOOK_COVER_INVALID_TIMEOUT",
                    status: facebookCoverPhotoChangeStatuses.ERROR,
                    stage,
                }
            );
        }

        let image;

        try {
            image = await loadImageFromPath(imagePath);
        } catch (error) {
            throw new FacebookCoverPhotoChangeError(error.message, {
                code: "FACEBOOK_COVER_INVALID_IMAGE",
                status: facebookCoverPhotoChangeStatuses.INVALID_IMAGE,
                stage,
                cause: error,
            });
        }

        const absolutePath = path.resolve(String(imagePath).trim());
        report(stage, "Файл шпалер перевірено", {
            filename: image.filename,
            contentType: image.contentType,
            bytes: image.buffer.length,
        });

        stage = "READ_CURRENT_COVER";
        previousCoverUrl = await readCoverUrl(page);
        report(
            stage,
            previousCoverUrl
                ? "Збережено URL поточних шпалер"
                : "Поточної обкладинки немає, після збереження має з’явитись URL",
            {
                selector: coverPhotoImageSelector,
                previousCoverUrl,
            }
        );

        stage = "OPEN_COVER_MENU";
        await openCoverEditingMenu(page, {
            timeout,
            report,
            timingOptions,
        });

        stage = "WAIT_COVER_MENU";
        await pauseAfterVisible(
            "long",
            report,
            stage,
            "повне завантаження меню Cover photo editing options",
            timingOptions
        );

        stage = "UPLOAD_COVER";
        await uploadCoverPhoto(page, absolutePath, {
            timeout,
            report,
            timingOptions,
        });

        stage = "WAIT_PREVIEW";
        await pauseAfterVisible(
            "veryLong",
            report,
            stage,
            "завантаження preview та скриптів reposition",
            timingOptions
        );

        stage = "SAVE";
        await clickFreshVisibleElement(
            page,
            saveCoverPhotoButtonSelector,
            {
                timeout,
                report,
                stage,
                description: "Save changes",
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
                (saveSelector, coverSelector, oldUrl) => {
                    const saveButton = document.querySelector(saveSelector);
                    const cover = document.querySelector(coverSelector);
                    const newUrl = (
                        cover?.currentSrc
                        || cover?.getAttribute("src")
                    ) ?? null;

                    return !saveButton
                        && Boolean(newUrl)
                        && newUrl !== oldUrl;
                },
                { timeout },
                saveCoverPhotoButtonSelector,
                coverPhotoImageSelector,
                previousCoverUrl
            );
        } catch (error) {
            currentCoverUrl = await readCoverUrl(page).catch(() => null);
            const saveStillVisible = await isVisible(
                page,
                saveCoverPhotoButtonSelector
            ).catch(() => false);

            throw new FacebookCoverPhotoChangeError(
                saveStillVisible
                    ? "Facebook не завершив збереження шпалер"
                    : "Facebook закрив preview, але URL шпалер не змінився",
                {
                    code: saveStillVisible
                        ? "FACEBOOK_COVER_SAVE_TIMEOUT"
                        : "FACEBOOK_COVER_NOT_CHANGED",
                    status: saveStillVisible
                        ? facebookCoverPhotoChangeStatuses.SAVE_FAILED
                        : facebookCoverPhotoChangeStatuses.VERIFICATION_FAILED,
                    stage,
                    selector: saveStillVisible
                        ? saveCoverPhotoButtonSelector
                        : coverPhotoImageSelector,
                    timeoutMs: timeout,
                    cause: error,
                }
            );
        } finally {
            await resultHandle?.dispose().catch(() => {});
        }

        stage = "VERIFY_COVER";
        currentCoverUrl = await readCoverUrl(page);

        if (!currentCoverUrl || currentCoverUrl === previousCoverUrl) {
            throw new FacebookCoverPhotoChangeError(
                "URL шпалер не змінився після збереження",
                {
                    code: "FACEBOOK_COVER_NOT_CHANGED",
                    status:
                        facebookCoverPhotoChangeStatuses.VERIFICATION_FAILED,
                    stage,
                    selector: coverPhotoImageSelector,
                    timeoutMs: timeout,
                }
            );
        }

        return finish(facebookCoverPhotoChangeStatuses.CHANGED);
    } catch (error) {
        const normalizedError = error instanceof FacebookCoverPhotoChangeError
            ? error
            : new FacebookCoverPhotoChangeError(
                error?.message ?? String(error),
                {
                    code: error?.code,
                    status: facebookCoverPhotoChangeStatuses.ERROR,
                    stage,
                    cause: error,
                }
            );
        stage = normalizedError.stage ?? stage;
        const errorDetails = createErrorDetails(normalizedError, { stage });
        const layers = await readVisibleLayers(page).catch(() => []);

        report(
            stage,
            `Помилка зміни шпалер: ${errorDetails.message}`,
            {
                ...errorDetails,
                visibleLayers: layers,
            },
            {
                level: "error",
                event: "facebook.cover_change.failed",
            }
        );

        return finish(normalizedError.status, {
            error: errorDetails,
            visibleLayerText: layers.join(" "),
        });
    }
}


export {
    coverPhotoEditingMenuItemSelector,
    coverPhotoEditingMenuSelector,
    coverPhotoImageSelector,
    coverPhotoUploadInputSelector,
    editCoverPhotoButtonSelector,
    saveCoverPhotoButtonSelector,
};
