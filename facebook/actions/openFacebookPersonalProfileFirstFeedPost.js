import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import {
    personalProfileFirstFeedPostCftLinkSelector,
    personalProfileFirstFeedPostPermalinkLinkSelector,
    personalProfileFirstFeedPostSelector,
} from "../selectors/personalProfilePost.js";
import { postDialogSelector } from "../selectors/post.js";


export const facebookPersonalProfileFirstFeedPostStatuses = Object.freeze({
    OPENED: "OPENED",
    INVALID_INPUT: "INVALID_INPUT",
    CARD_NOT_FOUND: "CARD_NOT_FOUND",
    CFT_LINK_NOT_FOUND: "CFT_LINK_NOT_FOUND",
    FIRST_FEED_POST_OPEN_FAILED: "FIRST_FEED_POST_OPEN_FAILED",
    ERROR: "ERROR",
});


class FacebookPersonalProfileFirstFeedPostError extends Error {
    constructor(message, {
        code = "FACEBOOK_PERSONAL_FIRST_FEED_POST_FAILED",
        status = facebookPersonalProfileFirstFeedPostStatuses.ERROR,
        stage = null,
        selector = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "FacebookPersonalProfileFirstFeedPostError";
        this.code = code;
        this.status = status;
        this.stage = stage;
        this.selector = selector;
    }
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
            `[openFacebookPersonalProfileFirstFeedPost] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


function isFacebookPostPermalink(value) {
    try {
        const url = new URL(value);
        if (
            !["http:", "https:"].includes(url.protocol)
            || !/(^|\.)facebook\.com$/i.test(url.hostname)
        ) {
            return false;
        }

        const pathname = url.pathname.toLocaleLowerCase();
        if (url.searchParams.get("story_fbid")) return true;
        if (pathname.endsWith("/permalink.php")) return true;
        if (/\/(?:posts|videos)\//i.test(pathname)) return true;
        if (pathname.includes("/photo") && url.searchParams.get("fbid")) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}


export function normalizeFacebookFeedPostUrl(value) {
    try {
        const url = new URL(value);
        url.hash = "";

        if (url.pathname.toLocaleLowerCase().endsWith("/permalink.php")) {
            const storyId = url.searchParams.get("story_fbid");
            const profileId = url.searchParams.get("id");
            url.search = "";
            if (storyId) url.searchParams.set("story_fbid", storyId);
            if (profileId) url.searchParams.set("id", profileId);
            return url.toString();
        }

        if (url.pathname.toLocaleLowerCase().includes("/photo")) {
            const photoId = url.searchParams.get("fbid");
            url.search = "";
            if (photoId) url.searchParams.set("fbid", photoId);
            return url.toString();
        }

        url.search = "";
        return url.toString();
    } catch {
        return null;
    }
}


export function createEmptyFeedFingerprint() {
    return {
        cft: null,
        permalink: null,
    };
}


export function isFeedFingerprintChanged(previous, current) {
    const before = {
        cft: previous?.cft ?? null,
        permalink: previous?.permalink ?? null,
    };
    const after = {
        cft: current?.cft ?? null,
        permalink: current?.permalink ?? null,
    };

    return (after.cft != null && after.cft !== before.cft)
        || (after.permalink != null && after.permalink !== before.permalink);
}


export function extractFacebookFeedPostId(postUrl) {
    if (!postUrl) return null;

    try {
        const url = new URL(postUrl);
        return url.searchParams.get("story_fbid")
            ?? url.searchParams.get("fbid")
            ?? url.pathname.match(/\/(?:posts|videos)\/([^/?]+)/i)?.[1]
            ?? null;
    } catch {
        return null;
    }
}


export async function readFirstFeedPostFingerprint(page) {
    if (!page || typeof page.evaluate !== "function") {
        return createEmptyFeedFingerprint();
    }

    try {
        const fingerprint = await page.evaluate((
            cardSelector,
            cftSelector,
            permalinkSelector
        ) => {
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            const card = Array.from(document.querySelectorAll(cardSelector))
                .find(visible);
            if (!card) {
                return { cft: null, permalink: null };
            }
            const cft = Array.from(card.querySelectorAll(cftSelector))
                .find(visible);
            const permalink = Array.from(card.querySelectorAll(permalinkSelector))
                .find(visible);
            return {
                cft: cft?.href ?? null,
                permalink: permalink?.href ?? null,
            };
        },
        personalProfileFirstFeedPostSelector,
        'a[href*="?__cft__[0]="]',
        'a[href*="/permalink.php"]');

        return {
            cft: fingerprint?.cft ?? null,
            permalink: fingerprint?.permalink ?? null,
        };
    } catch {
        return createEmptyFeedFingerprint();
    }
}


async function waitForFirstFeedPostChange(
    page,
    previousFingerprint,
    timeout
) {
    await page.waitForFunction((cardSelector, cftSelector, permalinkSelector, previous) => {
        const visible = (node) => {
            const rectangle = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        };
        const card = Array.from(document.querySelectorAll(cardSelector))
            .find(visible);
        if (!card) return false;
        const cft = Array.from(card.querySelectorAll(cftSelector))
            .find(visible)?.href ?? null;
        const permalink = Array.from(card.querySelectorAll(permalinkSelector))
            .find(visible)?.href ?? null;
        const beforeCft = previous?.cft ?? null;
        const beforePermalink = previous?.permalink ?? null;
        return (cft != null && cft !== beforeCft)
            || (permalink != null && permalink !== beforePermalink);
    }, { timeout },
    personalProfileFirstFeedPostSelector,
    'a[href*="?__cft__[0]="]',
    'a[href*="/permalink.php"]',
    previousFingerprint ?? createEmptyFeedFingerprint());
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


async function readOpenedPostUrl(page) {
    const currentUrl = typeof page.url === "function" ? page.url() : null;
    if (isFacebookPostPermalink(currentUrl)) {
        return normalizeFacebookFeedPostUrl(currentUrl);
    }

    try {
        const dialogUrl = await page.evaluate((selector) => {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                return rectangle.width > 0 && rectangle.height > 0;
            };
            const dialog = Array.from(document.querySelectorAll(selector))
                .filter(visible)
                .find((node) => {
                    const ids = normalize(node.getAttribute("aria-labelledby"))
                        .split(" ")
                        .filter(Boolean);
                    const heading = normalize(ids
                        .map((id) => document.getElementById(id)?.innerText)
                        .filter(Boolean)
                        .join(" "));
                    return /['\u2019](?:s\s+)?post$/i.test(heading);
                });
            if (!dialog) return null;
            const anchor = Array.from(dialog.querySelectorAll(
                'a[href*="story_fbid"], a[href*="/posts/"], '
                + 'a[href*="/photo/?fbid="], a[href*="/photo/"], '
                + 'a[href*="/videos/"]'
            )).find(visible);
            return anchor?.href ?? null;
        }, postDialogSelector);
        return isFacebookPostPermalink(dialogUrl)
            ? normalizeFacebookFeedPostUrl(dialogUrl)
            : null;
    } catch {
        return null;
    }
}


async function waitForOpenedPostUrl(page, timeout) {
    try {
        await page.waitForFunction((selector) => {
            const locationHref = window.location.href;
            try {
                const url = new URL(locationHref);
                const pathname = url.pathname.toLocaleLowerCase();
                if (
                    url.searchParams.get("story_fbid")
                    || pathname.endsWith("/permalink.php")
                    || /\/(?:posts|videos)\//i.test(pathname)
                    || (
                        pathname.includes("/photo")
                        && url.searchParams.get("fbid")
                    )
                ) {
                    return true;
                }
            } catch {
                // Адреса вкладки ще не є permalink поста.
            }

            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                return rectangle.width > 0 && rectangle.height > 0;
            };
            const dialog = Array.from(document.querySelectorAll(selector))
                .filter(visible)
                .find((node) => {
                    const ids = normalize(node.getAttribute("aria-labelledby"))
                        .split(" ")
                        .filter(Boolean);
                    const heading = normalize(ids
                        .map((id) => document.getElementById(id)?.innerText)
                        .filter(Boolean)
                        .join(" "));
                    return /['\u2019](?:s\s+)?post$/i.test(heading);
                });
            if (!dialog) return false;
            return Array.from(dialog.querySelectorAll(
                'a[href*="story_fbid"], a[href*="/posts/"], '
                + 'a[href*="/photo/?fbid="], a[href*="/photo/"], '
                + 'a[href*="/videos/"]'
            )).some(visible);
        }, { timeout }, postDialogSelector);
    } catch {
        // Permalink може з’явитися пізніше; дату все одно можна змінювати.
    }

    return readOpenedPostUrl(page);
}


export default async function openFacebookPersonalProfileFirstFeedPost(
    page,
    {
        previousFingerprint = null,
        timeout = 90000,
        random = Math.random,
        sleep,
        logger = console,
    } = {}
) {
    const startedAt = new Date().toISOString();
    const timingOptions = { random, ...(sleep ? { sleep } : {}) };
    let stage = "VALIDATE_INPUT";
    let status = facebookPersonalProfileFirstFeedPostStatuses.ERROR;
    let postUrl = null;
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
        if (!page || typeof page.url !== "function") {
            throw new FacebookPersonalProfileFirstFeedPostError(
                "Потрібна активна Puppeteer-сторінка",
                {
                    code: "FACEBOOK_PERSONAL_FIRST_FEED_POST_PAGE_REQUIRED",
                    status: facebookPersonalProfileFirstFeedPostStatuses
                        .INVALID_INPUT,
                    stage,
                }
            );
        }

        report(
            "facebook.first_feed_post.wait_card",
            "Чекаємо першу картку стрічки після публікації",
            {
                previousFingerprint,
                selector: personalProfileFirstFeedPostSelector,
            }
        );

        stage = "WAIT_CARD";
        try {
            await waitForFirstFeedPostChange(
                page,
                previousFingerprint,
                timeout
            );
        } catch (error) {
            throw new FacebookPersonalProfileFirstFeedPostError(
                "Перша картка стрічки не з’явилась або не змінилася",
                {
                    code: "FACEBOOK_PERSONAL_FIRST_FEED_POST_CARD_NOT_FOUND",
                    status: facebookPersonalProfileFirstFeedPostStatuses
                        .CARD_NOT_FOUND,
                    stage,
                    selector: personalProfileFirstFeedPostSelector,
                    cause: error,
                }
            );
        }

        stage = "CLICK_DATE";
        const currentFingerprint = await readFirstFeedPostFingerprint(page);
        const dateLinkSelector = currentFingerprint.cft
            ? personalProfileFirstFeedPostCftLinkSelector
            : personalProfileFirstFeedPostPermalinkLinkSelector;
        report(
            "facebook.first_feed_post.click_date",
            "Клікаємо дату першого поста",
            {
                selector: dateLinkSelector,
                fingerprint: currentFingerprint,
            }
        );
        let initialLink;
        try {
            initialLink = await waitForVisibleElement(
                page,
                dateLinkSelector,
                { timeout }
            );
        } catch (error) {
            throw new FacebookPersonalProfileFirstFeedPostError(
                "У першій картці немає посилання дати",
                {
                    code: "FACEBOOK_PERSONAL_FIRST_FEED_POST_CFT_NOT_FOUND",
                    status: facebookPersonalProfileFirstFeedPostStatuses
                        .CFT_LINK_NOT_FOUND,
                    stage,
                    selector: dateLinkSelector,
                    cause: error,
                }
            );
        }
        await initialLink.dispose().catch(() => {});
        await waitHuman("short", timingOptions);
        let freshLink;
        try {
            freshLink = await waitForVisibleElement(
                page,
                dateLinkSelector,
                { timeout }
            );
        } catch (error) {
            throw new FacebookPersonalProfileFirstFeedPostError(
                "Посилання дати зникло перед кліком",
                {
                    code: "FACEBOOK_PERSONAL_FIRST_FEED_POST_CFT_NOT_FOUND",
                    status: facebookPersonalProfileFirstFeedPostStatuses
                        .CFT_LINK_NOT_FOUND,
                    stage,
                    selector: dateLinkSelector,
                    cause: error,
                }
            );
        }
        try {
            await humanClickElement(page, freshLink, {
                beforeDelay: [100, 240],
                holdDelay: [70, 150],
                scrollDelay: [250, 550],
                ...timingOptions,
            });
        } finally {
            await freshLink.dispose().catch(() => {});
        }

        stage = "WAIT_DIALOG";
        try {
            await waitForPostWindow(page, timeout);
        } catch (error) {
            throw new FacebookPersonalProfileFirstFeedPostError(
                "Клік по даті не відкрив модальне вікно поста",
                {
                    code: "FACEBOOK_PERSONAL_FIRST_FEED_POST_OPEN_FAILED",
                    status: facebookPersonalProfileFirstFeedPostStatuses
                        .FIRST_FEED_POST_OPEN_FAILED,
                    stage,
                    selector: postDialogSelector,
                    cause: error,
                }
            );
        }

        stage = "READ_URL";
        postUrl = await waitForOpenedPostUrl(page, timeout);
        status = facebookPersonalProfileFirstFeedPostStatuses.OPENED;
        report(
            "facebook.first_feed_post.opened",
            "Відкрили пост і зчитали URL",
            {
                postUrl,
                selector: postDialogSelector,
            }
        );
    } catch (error) {
        const normalizedError = error instanceof
            FacebookPersonalProfileFirstFeedPostError
            ? error
            : new FacebookPersonalProfileFirstFeedPostError(error.message, {
                code: `FACEBOOK_PERSONAL_FIRST_FEED_POST_${stage}_FAILED`,
                stage,
                cause: error,
            });
        status = normalizedError.status;
        errorDetails = {
            code: normalizedError.code,
            message: normalizedError.message,
            selector: normalizedError.selector,
        };
        report(
            "facebook.first_feed_post.failed",
            normalizedError.message,
            {
                status,
                error: errorDetails,
            },
            "error"
        );
    }

    const success = status
        === facebookPersonalProfileFirstFeedPostStatuses.OPENED;
    return {
        success,
        status,
        stage: success ? "COMPLETED" : stage,
        postUrl,
        postId: extractFacebookFeedPostId(postUrl),
        previousFingerprint,
        startedAt,
        finishedAt: new Date().toISOString(),
        finalUrl: typeof page?.url === "function" ? page.url() : null,
        error: errorDetails,
    };
}
