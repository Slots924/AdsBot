import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import {
    personalProfileHeaderActionSelector,
    personalProfileInformationCloseButtonSelector,
    personalProfileInformationDialogSelector,
    personalProfileNameButtonCandidatesSelector,
    personalProfileTimelineLinkSelector,
} from "../selectors/personalProfileCreationDate.js";


const joinedFacebookTextPattern =
    /^Joined Facebook:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})$/i;
const monthNumbers = Object.freeze({
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
});

export const facebookPersonalProfileCreationDateStatuses = Object.freeze({
    FOUND: "FOUND",
    PROFILE_NAME_NOT_FOUND: "PROFILE_NAME_NOT_FOUND",
    TRIGGER_NOT_FOUND: "TRIGGER_NOT_FOUND",
    DIALOG_NOT_OPENED: "DIALOG_NOT_OPENED",
    DATE_NOT_FOUND: "DATE_NOT_FOUND",
    INVALID_DATE: "INVALID_DATE",
    CLEANUP_FAILED: "CLEANUP_FAILED",
    ERROR: "ERROR",
});


class FacebookPersonalProfileCreationDateError extends Error {
    constructor(message, {
        code = "FACEBOOK_PERSONAL_PROFILE_CREATION_DATE_FAILED",
        status = facebookPersonalProfileCreationDateStatuses.ERROR,
        stage = null,
        selector = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookPersonalProfileCreationDateError";
        this.code = code;
        this.status = status;
        this.stage = stage;
        this.selector = selector;
    }
}


function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
}


function emitLog(logger, level, event, message, fields = {}) {
    const method = logger?.[level];
    if (typeof method !== "function") return;

    try {
        if (typeof logger.child === "function") {
            method.call(logger, event, message, fields);
            return;
        }
        method.call(
            logger,
            `[getFacebookPersonalProfileCreationDate] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти read-only Facebook action.
    }
}


async function emitProgress(onProgress, event) {
    if (typeof onProgress !== "function") return;

    try {
        await onProgress(event);
    } catch {
        // Зовнішній progress callback не повинен зупиняти action.
    }
}


export function parseFacebookJoinedDate(rawText) {
    const normalized = normalizeText(rawText);
    const match = normalized.match(joinedFacebookTextPattern);
    if (!match) return null;

    const dateText = match[1];
    const dateMatch = dateText.match(
        /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/i
    );
    if (!dateMatch) return null;

    const month = monthNumbers[dateMatch[1].toLocaleLowerCase()];
    const day = Number(dateMatch[2]);
    const year = Number(dateMatch[3]);
    if (!month || !Number.isInteger(day) || !Number.isInteger(year)) {
        return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }

    return {
        rawText: normalized,
        dateText,
        isoDate: `${String(year).padStart(4, "0")}-`
            + `${String(month).padStart(2, "0")}-`
            + String(day).padStart(2, "0"),
        year,
        month,
        day,
        precision: "day",
    };
}


async function readJoinedFacebookText(page, rootSelector = null) {
    return page.evaluate(
        function readJoinedFacebookTextInBrowser(dialogSelector) {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            const roots = dialogSelector
                ? Array.from(document.querySelectorAll(dialogSelector))
                    .filter(visible)
                : [document.body];
            const matches = roots.flatMap((root) => Array.from(
                root.querySelectorAll("span, div")
            ))
                .filter(visible)
                .map((node) => normalize(node.innerText))
                .filter((text) => /^Joined Facebook:\s*[A-Za-z]+\s+\d{1,2},\s+\d{4}$/i.test(text))
                .sort((left, right) => left.length - right.length);
            return matches[0] ?? null;
        },
        rootSelector
    );
}


async function readProfileName(page) {
    return page.evaluate(
        function readProfileNameInBrowser(selector) {
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            const link = Array.from(document.querySelectorAll(selector))
                .find(visible);
            const label = String(link?.getAttribute("aria-label") ?? "")
                .replace(/\s+/g, " ")
                .trim();
            return label.replace(/[\'’]s Timeline$/i, "").trim() || null;
        },
        personalProfileTimelineLinkSelector
    );
}


async function waitForProfileNameButton(page, profileName, timeout) {
    try {
        await page.waitForFunction(
            function waitForProfileTriggerInBrowser(
                buttonSelector,
                headerActionSelector,
                expectedName
            ) {
                const normalize = (value) => String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase();
                const visible = (node) => {
                    const rectangle = node.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    return rectangle.width > 0
                        && rectangle.height > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && style.opacity !== "0";
                };
                return Array.from(document.querySelectorAll(buttonSelector))
                    .some((button) => {
                        if (!visible(button)) return false;
                        if (normalize(button.innerText) !== normalize(expectedName)) {
                            return false;
                        }
                        let container = button.parentElement;
                        for (let depth = 0; container && depth < 8; depth += 1) {
                            if (container.querySelector(headerActionSelector)) {
                                return true;
                            }
                            container = container.parentElement;
                        }
                        return false;
                    });
            },
            { timeout },
            personalProfileNameButtonCandidatesSelector,
            personalProfileHeaderActionSelector,
            profileName
        );
    } catch (error) {
        throw new FacebookPersonalProfileCreationDateError(
            "Не знайдено клікабельне ім’я у шапці профілю",
            {
                code: "FACEBOOK_PERSONAL_PROFILE_CREATION_TRIGGER_NOT_FOUND",
                status: facebookPersonalProfileCreationDateStatuses
                    .TRIGGER_NOT_FOUND,
                stage: "FIND_PROFILE_NAME_TRIGGER",
                selector: personalProfileNameButtonCandidatesSelector,
                cause: error,
            }
        );
    }
}


async function findProfileNameButton(page, profileName) {
    const handle = await page.evaluateHandle(
        function findProfileTriggerInBrowser(
            buttonSelector,
            headerActionSelector,
            expectedName
        ) {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            return Array.from(document.querySelectorAll(buttonSelector))
                .find((button) => {
                    if (!visible(button)) return false;
                    if (normalize(button.innerText) !== normalize(expectedName)) {
                        return false;
                    }
                    let container = button.parentElement;
                    for (let depth = 0; container && depth < 8; depth += 1) {
                        if (container.querySelector(headerActionSelector)) {
                            return true;
                        }
                        container = container.parentElement;
                    }
                    return false;
                }) ?? null;
        },
        personalProfileNameButtonCandidatesSelector,
        personalProfileHeaderActionSelector,
        profileName
    );
    const element = handle.asElement();
    if (!element) await handle.dispose().catch(() => {});
    return element;
}


async function clickVerifiedElement(page, element, timingOptions) {
    const movement = await moveMouseToElement(page, element, {
        scrollDelay: [250, 550],
        ...timingOptions,
    });
    const targetStillUnderPointer = await page.evaluate(
        function verifyTargetUnderPointerInBrowser(target, x, y) {
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && (hit === target || target.contains(hit)));
        },
        element,
        movement.x,
        movement.y
    );
    if (!targetStillUnderPointer) {
        throw new FacebookPersonalProfileCreationDateError(
            "Facebook замінив цільовий DOM-вузол перед кліком",
            {
                code: "FACEBOOK_PERSONAL_PROFILE_CREATION_TRIGGER_MOVED",
                status: facebookPersonalProfileCreationDateStatuses
                    .TRIGGER_NOT_FOUND,
                stage: "OPEN_PROFILE_INFORMATION",
                selector: personalProfileNameButtonCandidatesSelector,
            }
        );
    }
    await clickLeftMouse(page, {
        beforeDelay: [80, 160],
        holdDelay: [70, 140],
        ...timingOptions,
    });
}


async function waitForInformationDialog(page, profileName, timeout) {
    try {
        await page.waitForFunction(
            function waitForInfoDialogInBrowser(selector, expectedName) {
                const normalize = (value) => String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase();
                const visible = (node) => {
                    const rectangle = node.getBoundingClientRect();
                    const style = getComputedStyle(node);
                    return rectangle.width > 0
                        && rectangle.height > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && style.opacity !== "0";
                };
                return Array.from(document.querySelectorAll(selector))
                    .some((dialog) => {
                        if (!visible(dialog)) return false;
                        const text = normalize(dialog.innerText);
                        const heading = normalize(
                            dialog.querySelector("h1, h2")?.innerText
                        );
                        return heading === normalize(expectedName)
                            && (
                                text.includes("to keep facebook safe")
                                || text.includes("joined facebook:")
                            );
                    });
            },
            { timeout },
            personalProfileInformationDialogSelector,
            profileName
        );
    } catch (error) {
        throw new FacebookPersonalProfileCreationDateError(
            "Інформаційний діалог профілю не відкрився",
            {
                code: "FACEBOOK_PERSONAL_PROFILE_CREATION_DIALOG_NOT_OPENED",
                status: facebookPersonalProfileCreationDateStatuses
                    .DIALOG_NOT_OPENED,
                stage: "WAIT_PROFILE_INFORMATION",
                selector: personalProfileInformationDialogSelector,
                cause: error,
            }
        );
    }
}


async function findInformationCloseButton(page, profileName) {
    const handle = await page.evaluateHandle(
        function findInfoCloseButtonInBrowser(
            dialogSelector,
            closeSelector,
            expectedName
        ) {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            const dialog = Array.from(document.querySelectorAll(dialogSelector))
                .find((candidate) => {
                    if (!visible(candidate)) return false;
                    const heading = normalize(
                        candidate.querySelector("h1, h2")?.innerText
                    );
                    const text = normalize(candidate.innerText);
                    return heading === normalize(expectedName)
                        && (
                            text.includes("to keep facebook safe")
                            || text.includes("joined facebook:")
                        );
                });
            return dialog?.querySelector(closeSelector) ?? null;
        },
        personalProfileInformationDialogSelector,
        personalProfileInformationCloseButtonSelector,
        profileName
    );
    const element = handle.asElement();
    if (!element) await handle.dispose().catch(() => {});
    return element;
}


async function closeInformationDialog(
    page,
    profileName,
    timeout,
    timingOptions
) {
    const closeButton = await findInformationCloseButton(page, profileName);
    if (!closeButton) {
        throw new FacebookPersonalProfileCreationDateError(
            "Не знайдено кнопку закриття інформаційного діалогу",
            {
                code: "FACEBOOK_PERSONAL_PROFILE_CREATION_CLOSE_NOT_FOUND",
                status: facebookPersonalProfileCreationDateStatuses
                    .CLEANUP_FAILED,
                stage: "CLOSE_PROFILE_INFORMATION",
                selector: personalProfileInformationCloseButtonSelector,
            }
        );
    }
    try {
        await clickVerifiedElement(page, closeButton, timingOptions);
    } finally {
        await closeButton.dispose().catch(() => {});
    }
    await page.waitForFunction(
        function waitForInfoDialogClosedInBrowser(selector, expectedName) {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            return !Array.from(document.querySelectorAll(selector))
                .some((dialog) => visible(dialog)
                    && normalize(dialog.querySelector("h1, h2")?.innerText)
                        === normalize(expectedName));
        },
        { timeout },
        personalProfileInformationDialogSelector,
        profileName
    );
}


export default async function getFacebookPersonalProfileCreationDate(
    page,
    {
        timeout = 60000,
        random = Math.random,
        sleep,
        logger = console,
        onProgress = null,
    } = {}
) {
    const startedAt = new Date().toISOString();
    let stage = "VALIDATE_INPUT";
    let status = facebookPersonalProfileCreationDateStatuses.ERROR;
    let errorDetails = null;
    let parsedDate = null;
    let profileName = null;
    let source = null;
    let dialogOpened = false;
    let dialogClosed = false;
    const timingOptions = { random, ...(sleep ? { sleep } : {}) };
    const report = (event, message, fields = {}, level = "info") => emitLog(
        logger,
        level,
        event,
        message,
        {
            stage,
            currentUrl: typeof page?.url === "function" ? page.url() : null,
            ...fields,
        }
    );

    try {
        if (!page || typeof page.url !== "function") {
            throw new FacebookPersonalProfileCreationDateError(
                "Потрібна активна Puppeteer-сторінка",
                {
                    code: "FACEBOOK_PERSONAL_PROFILE_CREATION_PAGE_REQUIRED",
                    stage,
                }
            );
        }
        if (!Number.isFinite(timeout) || timeout <= 0) {
            throw new FacebookPersonalProfileCreationDateError(
                "timeout має бути додатним числом",
                {
                    code: "FACEBOOK_PERSONAL_PROFILE_CREATION_TIMEOUT_INVALID",
                    stage,
                }
            );
        }

        report(
            "facebook.profile_creation_date.started",
            "Починаємо читання дати створення особистого профілю"
        );
        stage = "READ_EXISTING_DOM";
        report(
            "facebook.profile_creation_date.selector.search",
            "Шукаємо Joined Facebook у поточному DOM",
            { expectedText: "Joined Facebook:" }
        );
        const existingText = await readJoinedFacebookText(page);
        if (existingText) {
            report(
                "facebook.profile_creation_date.selector.found",
                "Joined Facebook знайдено у поточному DOM",
                { rawText: existingText }
            );
            parsedDate = parseFacebookJoinedDate(existingText);
            if (!parsedDate) {
                throw new FacebookPersonalProfileCreationDateError(
                    "Facebook повернув некоректну дату Joined Facebook",
                    {
                        code: "FACEBOOK_PERSONAL_PROFILE_CREATION_DATE_INVALID",
                        status: facebookPersonalProfileCreationDateStatuses
                            .INVALID_DATE,
                        stage,
                    }
                );
            }
            profileName = await readProfileName(page);
            source = "existing_dom";
            status = facebookPersonalProfileCreationDateStatuses.FOUND;
        } else {
            stage = "READ_PROFILE_NAME";
            report(
                "facebook.profile_creation_date.selector.search",
                "Визначаємо ім’я через посилання на Timeline",
                { selector: personalProfileTimelineLinkSelector }
            );
            profileName = await readProfileName(page);
            if (!profileName) {
                throw new FacebookPersonalProfileCreationDateError(
                    "Не вдалося визначити ім’я поточного профілю",
                    {
                        code: "FACEBOOK_PERSONAL_PROFILE_CREATION_NAME_NOT_FOUND",
                        status: facebookPersonalProfileCreationDateStatuses
                            .PROFILE_NAME_NOT_FOUND,
                        stage,
                        selector: personalProfileTimelineLinkSelector,
                    }
                );
            }
            report(
                "facebook.profile_creation_date.selector.found",
                "Ім’я поточного профілю визначено",
                {
                    selector: personalProfileTimelineLinkSelector,
                    profileName,
                }
            );

            stage = "FIND_PROFILE_NAME_TRIGGER";
            report(
                "facebook.profile_creation_date.selector.search",
                "Шукаємо клікабельне ім’я у шапці профілю",
                {
                    selector: personalProfileNameButtonCandidatesSelector,
                    profileName,
                }
            );
            await waitForProfileNameButton(page, profileName, timeout);
            await waitHuman("medium", timingOptions);
            const trigger = await findProfileNameButton(page, profileName);
            if (!trigger) {
                throw new FacebookPersonalProfileCreationDateError(
                    "Кнопка імені зникла після стабілізації React",
                    {
                        code: "FACEBOOK_PERSONAL_PROFILE_CREATION_TRIGGER_DETACHED",
                        status: facebookPersonalProfileCreationDateStatuses
                            .TRIGGER_NOT_FOUND,
                        stage,
                        selector: personalProfileNameButtonCandidatesSelector,
                    }
                );
            }
            report(
                "facebook.profile_creation_date.selector.found",
                "Знайдено свіжу кнопку імені у шапці профілю",
                {
                    selector: personalProfileNameButtonCandidatesSelector,
                    profileName,
                }
            );

            stage = "OPEN_PROFILE_INFORMATION";
            try {
                await clickVerifiedElement(page, trigger, timingOptions);
            } finally {
                await trigger.dispose().catch(() => {});
            }

            stage = "WAIT_PROFILE_INFORMATION";
            report(
                "facebook.profile_creation_date.selector.search",
                "Очікуємо інформаційний діалог профілю",
                { selector: personalProfileInformationDialogSelector }
            );
            await waitForInformationDialog(page, profileName, timeout);
            dialogOpened = true;
            report(
                "facebook.profile_creation_date.selector.found",
                "Інформаційний діалог профілю відкрито",
                { selector: personalProfileInformationDialogSelector }
            );
            await emitProgress(onProgress, {
                type: "profile_information_opened",
                profileName,
            });

            stage = "READ_JOINED_DATE";
            await waitHuman("medium", timingOptions);
            const dialogText = await readJoinedFacebookText(
                page,
                personalProfileInformationDialogSelector
            );
            if (!dialogText) {
                throw new FacebookPersonalProfileCreationDateError(
                    "В інформаційному діалозі немає Joined Facebook",
                    {
                        code: "FACEBOOK_PERSONAL_PROFILE_CREATION_DATE_NOT_FOUND",
                        status: facebookPersonalProfileCreationDateStatuses
                            .DATE_NOT_FOUND,
                        stage,
                        selector: personalProfileInformationDialogSelector,
                    }
                );
            }
            report(
                "facebook.profile_creation_date.date.found",
                "Текст Joined Facebook знайдено",
                { rawText: dialogText }
            );
            parsedDate = parseFacebookJoinedDate(dialogText);
            if (!parsedDate) {
                throw new FacebookPersonalProfileCreationDateError(
                    "Не вдалося розібрати дату Joined Facebook",
                    {
                        code: "FACEBOOK_PERSONAL_PROFILE_CREATION_DATE_INVALID",
                        status: facebookPersonalProfileCreationDateStatuses
                            .INVALID_DATE,
                        stage,
                    }
                );
            }
            source = "profile_info_dialog";
            status = facebookPersonalProfileCreationDateStatuses.FOUND;
            report(
                "facebook.profile_creation_date.date.parsed",
                "Дату створення профілю розібрано",
                { ...parsedDate, profileName, source }
            );
        }
    } catch (error) {
        const normalized = error instanceof FacebookPersonalProfileCreationDateError
            ? error
            : new FacebookPersonalProfileCreationDateError(
                error?.message ?? String(error),
                {
                    code: `FACEBOOK_PERSONAL_PROFILE_CREATION_${stage}_FAILED`,
                    stage,
                    cause: error,
                }
            );
        status = normalized.status;
        errorDetails = {
            code: normalized.code,
            message: normalized.message,
            stage: normalized.stage ?? stage,
            selector: normalized.selector,
        };
    } finally {
        if (dialogOpened) {
            stage = "CLOSE_PROFILE_INFORMATION";
            report(
                "facebook.profile_creation_date.selector.search",
                "Шукаємо Close у відкритому нами діалозі",
                { selector: personalProfileInformationCloseButtonSelector }
            );
            try {
                await closeInformationDialog(
                    page,
                    profileName,
                    timeout,
                    timingOptions
                );
                dialogClosed = true;
                report(
                    "facebook.profile_creation_date.dialog.closed",
                    "Інформаційний діалог профілю закрито",
                    { selector: personalProfileInformationCloseButtonSelector }
                );
                await emitProgress(onProgress, {
                    type: "profile_information_closed",
                    profileName,
                });
            } catch (cleanupError) {
                dialogClosed = false;
                const cleanupDetails = {
                    code: cleanupError?.code
                        ?? "FACEBOOK_PERSONAL_PROFILE_CREATION_CLEANUP_FAILED",
                    message: cleanupError?.message ?? String(cleanupError),
                    stage,
                    selector: cleanupError?.selector
                        ?? personalProfileInformationCloseButtonSelector,
                };
                if (status === facebookPersonalProfileCreationDateStatuses.FOUND) {
                    status = facebookPersonalProfileCreationDateStatuses
                        .CLEANUP_FAILED;
                    errorDetails = cleanupDetails;
                } else if (errorDetails) {
                    errorDetails.cleanup = cleanupDetails;
                } else {
                    errorDetails = cleanupDetails;
                }
                report(
                    "facebook.profile_creation_date.cleanup.failed",
                    "Не вдалося закрити інформаційний діалог",
                    cleanupDetails,
                    "error"
                );
            }
        }
    }

    const success = status === facebookPersonalProfileCreationDateStatuses.FOUND;
    const result = {
        success,
        status,
        stage: success ? "COMPLETED" : errorDetails?.stage ?? stage,
        rawText: parsedDate?.rawText ?? null,
        dateText: parsedDate?.dateText ?? null,
        isoDate: parsedDate?.isoDate ?? null,
        year: parsedDate?.year ?? null,
        month: parsedDate?.month ?? null,
        day: parsedDate?.day ?? null,
        precision: parsedDate?.precision ?? null,
        profileName,
        source,
        dialogOpened,
        dialogClosed,
        startedAt,
        finishedAt: new Date().toISOString(),
        finalUrl: typeof page?.url === "function" ? page.url() : null,
        error: errorDetails,
    };
    report(
        success
            ? "facebook.profile_creation_date.completed"
            : "facebook.profile_creation_date.failed",
        success
            ? "Дату створення особистого профілю отримано"
            : "Не вдалося отримати дату створення особистого профілю",
        {
            status,
            isoDate: result.isoDate,
            source,
            dialogOpened,
            dialogClosed,
            error: errorDetails,
        },
        success ? "info" : "error"
    );
    return result;
}
