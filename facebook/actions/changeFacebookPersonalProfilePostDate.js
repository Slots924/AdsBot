import openPageWithoutPopups from "./openPageWithoutPopups.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import isPostAvailable from "../post/checks/isPostAvailable.js";
import { postDialogSelector } from "../selectors/post.js";
import {
    personalProfileEditDateCancelButtonSelector,
    personalProfileEditDateComboboxSelector,
    personalProfileEditDateDialogSelector,
    personalProfileEditDateDoneButtonSelector,
    personalProfilePostActionsButtonSelector,
    personalProfilePostCloseButtonSelector,
    personalProfilePostMenuItemSelector,
} from "../selectors/personalProfilePostDate.js";


const monthNumbers = Object.freeze({
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
});

export const facebookPersonalProfilePostDateStatuses = Object.freeze({
    CHANGED: "CHANGED",
    INVALID_INPUT: "INVALID_INPUT",
    POST_NOT_AVAILABLE: "POST_NOT_AVAILABLE",
    ACTIONS_NOT_FOUND: "ACTIONS_NOT_FOUND",
    EDIT_DATE_NOT_FOUND: "EDIT_DATE_NOT_FOUND",
    DIALOG_NOT_OPENED: "DIALOG_NOT_OPENED",
    DATE_INPUT_FAILED: "DATE_INPUT_FAILED",
    SAVE_FAILED: "SAVE_FAILED",
    VERIFY_FAILED: "VERIFY_FAILED",
    CLEANUP_FAILED: "CLEANUP_FAILED",
    ERROR: "ERROR",
});


class FacebookPersonalProfilePostDateError extends Error {
    constructor(message, {
        code = "FACEBOOK_PERSONAL_POST_DATE_FAILED",
        status = facebookPersonalProfilePostDateStatuses.ERROR,
        stage = null,
        selector = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookPersonalProfilePostDateError";
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
            `[changeFacebookPersonalProfilePostDate] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


async function emitProgress(onProgress, event) {
    if (typeof onProgress !== "function") return;

    try {
        await onProgress(event);
    } catch {
        // Зовнішній progress callback не повинен зупиняти Facebook action.
    }
}


function createDateParts(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        return null;
    }

    return {
        year,
        month,
        day,
        isoDate: `${String(year).padStart(4, "0")}-`
            + `${String(month).padStart(2, "0")}-`
            + String(day).padStart(2, "0"),
        inputDate: `${String(month).padStart(2, "0")}/`
            + `${String(day).padStart(2, "0")}/`
            + String(year).padStart(4, "0"),
    };
}


export function parseFacebookPersonalProfilePostDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return createDateParts(
            value.getUTCFullYear(),
            value.getUTCMonth() + 1,
            value.getUTCDate()
        );
    }

    const text = normalizeText(value);
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return createDateParts(
            Number(match[1]),
            Number(match[2]),
            Number(match[3])
        );
    }

    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
        return createDateParts(
            Number(match[3]),
            Number(match[1]),
            Number(match[2])
        );
    }

    match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/i);
    if (match) {
        const month = monthNumbers[match[1].toLocaleLowerCase()];
        return month
            ? createDateParts(Number(match[3]), month, Number(match[2]))
            : null;
    }

    return null;
}


function validatePostUrl(value) {
    if (!value) return null;

    try {
        const url = new URL(value);
        if (
            !["http:", "https:"].includes(url.protocol)
            || !/(^|\.)facebook\.com$/i.test(url.hostname)
        ) {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}


async function waitForPostWindow(page, timeout) {
    await page.waitForFunction((selector) => {
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
        return Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .some((dialog) => {
                const ids = normalize(dialog.getAttribute("aria-labelledby"))
                    .split(" ")
                    .filter(Boolean);
                const heading = normalize(ids
                    .map((id) => document.getElementById(id)?.innerText)
                    .filter(Boolean)
                    .join(" "));
                return /['\u2019](?:s\s+)?post$/i.test(heading);
            });
    }, { timeout }, postDialogSelector);
}


async function findElement(page, kind) {
    const handle = await page.evaluateHandle((selectors, targetKind) => {
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
        const dialogName = (dialog) => {
            const ids = normalize(dialog.getAttribute("aria-labelledby"))
                .split(" ")
                .filter(Boolean);
            return normalize(ids
                .map((id) => document.getElementById(id)?.innerText)
                .filter(Boolean)
                .join(" "));
        };
        const postDialog = Array.from(document.querySelectorAll(
            selectors.postDialog
        ))
            .filter(visible)
            .find((dialog) => /['\u2019](?:s\s+)?post$/i.test(
                dialogName(dialog)
            ));
        const editDateDialog = Array.from(document.querySelectorAll(
            selectors.editDateDialog
        ))
            .filter(visible)
            .find((dialog) => /^edit date$/i.test(dialogName(dialog)));

        if (targetKind === "actions") {
            return Array.from(document.querySelectorAll(selectors.actions))
                .find((element) => postDialog?.contains(element)) ?? null;
        }
        if (targetKind === "editDateMenuItem") {
            return Array.from(document.querySelectorAll(selectors.menuItem))
                .filter(visible)
                .find((item) => /^edit date$/i.test(
                    normalize(item.innerText)
                )) ?? null;
        }
        if (targetKind === "dateInput") {
            return Array.from(editDateDialog?.querySelectorAll(
                selectors.combobox
            ) ?? [])
                .filter(visible)
                .find((input) => /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}$/i.test(
                    normalize(input.value)
                )) ?? null;
        }
        if (targetKind === "done") {
            return editDateDialog?.querySelector(selectors.done) ?? null;
        }
        if (targetKind === "cancel") {
            return editDateDialog?.querySelector(selectors.cancel) ?? null;
        }
        if (targetKind === "closePost") {
            return postDialog?.querySelector(selectors.closePost) ?? null;
        }
        return null;
    }, {
        postDialog: postDialogSelector,
        actions: personalProfilePostActionsButtonSelector,
        menuItem: personalProfilePostMenuItemSelector,
        editDateDialog: personalProfileEditDateDialogSelector,
        combobox: personalProfileEditDateComboboxSelector,
        done: personalProfileEditDateDoneButtonSelector,
        cancel: personalProfileEditDateCancelButtonSelector,
        closePost: personalProfilePostCloseButtonSelector,
    }, kind);
    const element = handle.asElement();
    if (!element) await handle.dispose().catch(() => {});
    return element;
}


async function waitForElement(page, kind, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const element = await findElement(page, kind);
        if (element) return element;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
}


async function clickFreshElement(
    page,
    kind,
    selector,
    timeout,
    timingOptions,
    report
) {
    report("facebook.personal_post_date.selector.search", "Шукаємо селектор", {
        selector,
        kind,
    });
    const initial = await waitForElement(page, kind, timeout);
    if (!initial) return false;
    report("facebook.personal_post_date.selector.found", "Селектор знайдено", {
        selector,
        kind,
    });
    await initial.dispose().catch(() => {});
    await waitHuman("short", timingOptions);
    const fresh = await waitForElement(page, kind, timeout);
    if (!fresh) return false;

    try {
        await humanClickElement(page, fresh, {
            beforeDelay: [100, 240],
            holdDelay: [70, 150],
            scrollDelay: [250, 550],
            ...timingOptions,
        });
    } finally {
        await fresh.dispose().catch(() => {});
    }
    return true;
}


async function waitForEditDateDialog(page, timeout, shouldExist = true) {
    await page.waitForFunction((selector, expected) => {
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
        const exists = Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .some((dialog) => {
                const ids = normalize(dialog.getAttribute("aria-labelledby"))
                    .split(" ")
                    .filter(Boolean);
                return /^edit date$/i.test(normalize(ids
                    .map((id) => document.getElementById(id)?.innerText)
                    .filter(Boolean)
                    .join(" ")));
            });
        return exists === expected;
    }, { timeout }, personalProfileEditDateDialogSelector, shouldExist);
}


async function readDateInput(page) {
    const input = await findElement(page, "dateInput");
    if (!input) return null;
    try {
        return await input.evaluate((node) => node.value);
    } finally {
        await input.dispose().catch(() => {});
    }
}


async function waitForInputDate(page, target, timeout) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await readDateInput(page);
        const parsed = parseFacebookPersonalProfilePostDate(value);
        if (parsed?.isoDate === target.isoDate) return value;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
}


async function verifyPostDate(page, target, timeout) {
    await page.waitForFunction((selector, expected) => {
        const months = {
            january: 1, february: 2, march: 3, april: 4,
            may: 5, june: 6, july: 7, august: 8,
            september: 9, october: 10, november: 11, december: 12,
        };
        const normalize = (value) => String(value ?? "")
            .replace(/\s+/g, " ")
            .trim();
        const visible = (node) => {
            const rectangle = node.getBoundingClientRect();
            return rectangle.width > 0 && rectangle.height > 0;
        };
        return Array.from(document.querySelectorAll(selector))
            .filter(visible)
            .some((anchor) => {
                const match = normalize(anchor.innerText).match(
                    /^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/i
                );
                if (!match) return false;
                const iso = `${match[3]}-`
                    + `${String(months[match[1].toLocaleLowerCase()]).padStart(2, "0")}-`
                    + String(Number(match[2])).padStart(2, "0");
                return iso === expected;
            });
    }, { timeout },
    `${postDialogSelector} a[href*="story_fbid"], `
        + `${postDialogSelector} a[href*="/posts/"], `
        + `${postDialogSelector} a[href*="/photo/"]`,
    target.isoDate);
}


export default async function changeFacebookPersonalProfilePostDate(
    page,
    {
        postUrl = null,
        targetDate,
        timeout = 90000,
        random = Math.random,
        sleep,
        logger = console,
        onProgress = null,
        closePostDialog = true,
    } = {}
) {
    const startedAt = new Date().toISOString();
    const target = parseFacebookPersonalProfilePostDate(targetDate);
    const normalizedPostUrl = validatePostUrl(postUrl);
    const timingOptions = { random, ...(sleep ? { sleep } : {}) };
    let stage = "VALIDATE_INPUT";
    let status = facebookPersonalProfilePostDateStatuses.ERROR;
    let formattedDate = null;
    let verified = false;
    let postDialogClosed = false;
    let errorDetails = null;
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
        if (!page || typeof page.url !== "function" || !target) {
            throw new FacebookPersonalProfilePostDateError(
                "Потрібна Puppeteer-сторінка та коректна targetDate",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_INPUT_INVALID",
                    status: facebookPersonalProfilePostDateStatuses.INVALID_INPUT,
                    stage,
                }
            );
        }
        if (postUrl && !normalizedPostUrl) {
            throw new FacebookPersonalProfilePostDateError(
                "postUrl має бути коректним Facebook URL",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_URL_INVALID",
                    status: facebookPersonalProfilePostDateStatuses.INVALID_INPUT,
                    stage,
                }
            );
        }

        report("facebook.personal_post_date.started", "Починаємо зміну дати поста", {
            postUrl: normalizedPostUrl,
            targetDate: target.isoDate,
        });

        if (normalizedPostUrl) {
            stage = "OPEN_POST";
            report("facebook.personal_post_date.navigation", "Відкриваємо точний URL поста", {
                postUrl: normalizedPostUrl,
            });
            await openPageWithoutPopups(page, normalizedPostUrl, { timeout });
        }

        stage = "WAIT_POST";
        report("facebook.personal_post_date.selector.search", "Шукаємо універсальне модальне вікно поста", {
            selector: postDialogSelector,
        });
        await waitForPostWindow(page, timeout);
        if (!await isPostAvailable(page, { logger })) {
            throw new FacebookPersonalProfilePostDateError(
                "Пост не відкрився або його контент недоступний",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_POST_UNAVAILABLE",
                    status: facebookPersonalProfilePostDateStatuses.POST_NOT_AVAILABLE,
                    stage,
                    selector: postDialogSelector,
                }
            );
        }
        report("facebook.personal_post_date.selector.found", "Модальне вікно поста знайдено", {
            selector: postDialogSelector,
        });

        stage = "OPEN_ACTIONS";
        if (!await clickFreshElement(
            page,
            "actions",
            personalProfilePostActionsButtonSelector,
            timeout,
            timingOptions,
            report
        )) {
            throw new FacebookPersonalProfilePostDateError(
                "Не знайдено меню дій поста",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_ACTIONS_NOT_FOUND",
                    status: facebookPersonalProfilePostDateStatuses.ACTIONS_NOT_FOUND,
                    stage,
                    selector: personalProfilePostActionsButtonSelector,
                }
            );
        }

        stage = "OPEN_EDIT_DATE";
        if (!await clickFreshElement(
            page,
            "editDateMenuItem",
            personalProfilePostMenuItemSelector,
            timeout,
            timingOptions,
            report
        )) {
            throw new FacebookPersonalProfilePostDateError(
                "У меню поста не знайдено Edit date",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_MENU_ITEM_NOT_FOUND",
                    status: facebookPersonalProfilePostDateStatuses.EDIT_DATE_NOT_FOUND,
                    stage,
                    selector: personalProfilePostMenuItemSelector,
                }
            );
        }
        await waitForEditDateDialog(page, timeout, true);
        await waitHuman("short", timingOptions);

        stage = "ENTER_DATE";
        report("facebook.personal_post_date.selector.search", "Шукаємо поле дати в Edit Date", {
            selector: personalProfileEditDateComboboxSelector,
        });
        const dateInput = await waitForElement(page, "dateInput", timeout);
        if (!dateInput) {
            throw new FacebookPersonalProfilePostDateError(
                "Не знайдено поле дати",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_INPUT_NOT_FOUND",
                    status: facebookPersonalProfilePostDateStatuses.DATE_INPUT_FAILED,
                    stage,
                    selector: personalProfileEditDateComboboxSelector,
                }
            );
        }
        report("facebook.personal_post_date.selector.found", "Поле дати знайдено", {
            selector: personalProfileEditDateComboboxSelector,
        });
        try {
            await humanClickElement(page, dateInput, {
                beforeDelay: [80, 180],
                holdDelay: [60, 130],
                scrollDelay: [200, 450],
                ...timingOptions,
            });
        } finally {
            await dateInput.dispose().catch(() => {});
        }
        await page.keyboard.down("Control");
        await page.keyboard.press("A");
        await page.keyboard.up("Control");
        await page.keyboard.type(target.inputDate, {
            delay: 35 + Math.floor(random() * 55),
        });
        await page.keyboard.press("Enter");

        formattedDate = await waitForInputDate(page, target, timeout);
        if (!formattedDate) {
            throw new FacebookPersonalProfilePostDateError(
                "React не підтвердив введену дату",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_INPUT_NOT_APPLIED",
                    status: facebookPersonalProfilePostDateStatuses.DATE_INPUT_FAILED,
                    stage,
                    selector: personalProfileEditDateComboboxSelector,
                }
            );
        }
        report("facebook.personal_post_date.input.applied", "Facebook відформатував потрібну дату", {
            inputDate: target.inputDate,
            formattedDate,
            isoDate: target.isoDate,
        });

        stage = "SAVE_DATE";
        if (!await clickFreshElement(
            page,
            "done",
            personalProfileEditDateDoneButtonSelector,
            timeout,
            timingOptions,
            report
        )) {
            throw new FacebookPersonalProfilePostDateError(
                "Не знайдено кнопку Done",
                {
                    code: "FACEBOOK_PERSONAL_POST_DATE_DONE_NOT_FOUND",
                    status: facebookPersonalProfilePostDateStatuses.SAVE_FAILED,
                    stage,
                    selector: personalProfileEditDateDoneButtonSelector,
                }
            );
        }
        await waitForEditDateDialog(page, timeout, false);

        stage = "VERIFY_DATE";
        await verifyPostDate(page, target, timeout);
        verified = true;
        status = facebookPersonalProfilePostDateStatuses.CHANGED;

        if (closePostDialog) {
            stage = "CLOSE_POST";
            postDialogClosed = await clickFreshElement(
                page,
                "closePost",
                `${postDialogSelector} ${personalProfilePostCloseButtonSelector}`,
                timeout,
                timingOptions,
                report
            );
            if (!postDialogClosed) {
                throw new FacebookPersonalProfilePostDateError(
                    "Не вдалося закрити відкрите вікно поста",
                    {
                        code: "FACEBOOK_PERSONAL_POST_DATE_CLOSE_FAILED",
                        status: facebookPersonalProfilePostDateStatuses.CLEANUP_FAILED,
                        stage,
                        selector: personalProfilePostCloseButtonSelector,
                    }
                );
            }
            await page.waitForFunction((selector) => {
                const visible = (node) => {
                    const rectangle = node.getBoundingClientRect();
                    return rectangle.width > 0 && rectangle.height > 0;
                };
                return !Array.from(document.querySelectorAll(selector))
                    .filter(visible)
                    .some((dialog) => {
                        const ids = String(
                            dialog.getAttribute("aria-labelledby") ?? ""
                        ).split(/\s+/).filter(Boolean);
                        const heading = ids
                            .map((id) => document.getElementById(id)?.innerText)
                            .filter(Boolean)
                            .join(" ")
                            .replace(/\s+/g, " ")
                            .trim();
                        return /['\u2019](?:s\s+)?post$/i.test(heading);
                    });
            }, { timeout }, postDialogSelector);
        }

        await emitProgress(onProgress, {
            type: "post_date_changed",
            postUrl: normalizedPostUrl ?? page.url(),
            isoDate: target.isoDate,
        });
    } catch (error) {
        const normalizedError = error instanceof FacebookPersonalProfilePostDateError
            ? error
            : new FacebookPersonalProfilePostDateError(error.message, {
                code: `FACEBOOK_PERSONAL_POST_DATE_${stage}_FAILED`,
                stage,
                cause: error,
            });
        status = normalizedError.status;
        errorDetails = {
            code: normalizedError.code,
            message: normalizedError.message,
            selector: normalizedError.selector,
        };
        report("facebook.personal_post_date.failed", normalizedError.message, {
            status,
            error: errorDetails,
        }, "error");

        try {
            const cancel = await findElement(page, "cancel");
            if (cancel) {
                try {
                    await humanClickElement(page, cancel, {
                        beforeDelay: [80, 160],
                        holdDelay: [60, 120],
                        scrollDelay: [200, 400],
                        ...timingOptions,
                    });
                } finally {
                    await cancel.dispose().catch(() => {});
                }
            }
        } catch {
            // Основну помилку не замінюємо помилкою аварійного закриття.
        }
    }

    const success = status === facebookPersonalProfilePostDateStatuses.CHANGED;
    return {
        success,
        status,
        stage: success ? "COMPLETED" : stage,
        postUrl: normalizedPostUrl ?? null,
        targetDate: target?.isoDate ?? null,
        inputDate: target?.inputDate ?? null,
        formattedDate,
        verified,
        postDialogClosed,
        startedAt,
        finishedAt: new Date().toISOString(),
        finalUrl: typeof page?.url === "function" ? page.url() : null,
        error: errorDetails,
    };
}
