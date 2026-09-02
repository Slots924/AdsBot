import openPageWithoutPopups from "./openPageWithoutPopups.js";
import { clickUntilConfirmed } from "../browser/confirmedClick.js";
import isPostAvailable from "../post/checks/isPostAvailable.js";


export const firstAuthorPagePostSelector = '[aria-posinset="1"]';

export const firstAuthorPagePostPermalinkSelector =
    `${firstAuthorPagePostSelector} `
    + 'a[role="link"][href*="permalink.php"]:not([href*="comment_id="])';

export const firstAuthorPagePostCftSelector =
    `${firstAuthorPagePostSelector} a[href*="__cft__[0]"]`
    + ':not([href*="/photo/"])'
    + ':not([href*="photo.php"])'
    + ':not([href*="comment_id="])'
    + ':not([href*="profile.php"])';

export const facebookPostViaAuthorPageStatuses = Object.freeze({
    OPENED: "OPENED",
    INVALID_INPUT: "INVALID_INPUT",
    PAGE_ID_NOT_FOUND: "PAGE_ID_NOT_FOUND",
    POST_ID_NOT_FOUND: "POST_ID_NOT_FOUND",
    FIRST_POST_NOT_FOUND: "FIRST_POST_NOT_FOUND",
    DATE_LINK_NOT_FOUND: "DATE_LINK_NOT_FOUND",
    POST_NOT_OPENED: "POST_NOT_OPENED",
    WRONG_POST_OPENED: "WRONG_POST_OPENED",
    ERROR: "ERROR",
});


function createError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function isFacebookPostUrl() {
    try {
        const url = new URL(window.location.href);
        if (url.searchParams.get("story_fbid")) return true;

        const segments = url.pathname.split("/").filter(Boolean);
        const postsIndex = segments.findIndex((segment) => segment === "posts");
        return postsIndex >= 0 && Boolean(segments[postsIndex + 1]);
    } catch {
        return false;
    }
}


function createOpenedPostUrlCheck() {
    return {
        check: isFacebookPostUrl,
        description: "URL будь-якого Facebook-допису",
    };
}


function createClickableDateLinkSelector(selector) {
    return `${selector}, ${selector} *`;
}


function createStepLogger(logger) {
    return (message, details) => logStep(logger, message, details);
}


function isFacebookHost(hostname) {
    return /(^|\.)facebook\.com$/i.test(hostname);
}


export function extractFacebookAuthorPageId(postUrl) {
    try {
        const url = new URL(postUrl);
        if (!isFacebookHost(url.hostname)) return null;

        const permalinkPageId = url.searchParams.get("id");
        if (/^\d+$/.test(permalinkPageId ?? "")) return permalinkPageId;

        const segments = url.pathname.split("/").filter(Boolean);
        const postsIndex = segments.findIndex((segment) => segment === "posts");
        const candidate = postsIndex > 0 ? segments[postsIndex - 1] : null;
        return /^\d+$/.test(candidate ?? "") ? candidate : null;
    } catch {
        return null;
    }
}


export function extractFacebookPostId(postUrl) {
    try {
        const url = new URL(postUrl);
        if (!isFacebookHost(url.hostname)) return null;

        const permalinkPostId = url.searchParams.get("story_fbid");
        if (permalinkPostId) return permalinkPostId;

        const segments = url.pathname.split("/").filter(Boolean);
        const postsIndex = segments.findIndex((segment) => segment === "posts");
        return postsIndex >= 0 ? segments[postsIndex + 1] ?? null : null;
    } catch {
        return null;
    }
}


export function doesFacebookPostUrlMatch(postUrl, expectedPostId) {
    const actualPostId = extractFacebookPostId(postUrl);
    return Boolean(actualPostId)
        && actualPostId === String(expectedPostId ?? "").trim();
}


function logStep(logger, message, details = {}) {
    const prefix = "[Відкриття допису через автора]";

    if (typeof logger?.child === "function" && typeof logger?.info === "function") {
        logger.info("facebook.post-via-author-page", `${prefix} ${message}`, details);
        return;
    }

    if (typeof logger?.info === "function") {
        logger.info(`${prefix} ${message}`, details);
        return;
    }

    logger?.log?.(`${prefix} ${message}`, details);
}


async function highlightDateLink(page, selector) {
    return page.evaluate((targetSelector) => {
        const element = document.querySelector(targetSelector);
        if (!element) return null;

        element.style.setProperty("outline", "4px solid #ff0000", "important");
        element.style.setProperty("outline-offset", "3px", "important");
        element.style.setProperty("background-color", "rgba(255, 0, 0, 0.18)", "important");

        return {
            href: element.getAttribute("href"),
            text: element.innerText?.trim() ?? "",
            tagName: element.tagName,
        };
    }, selector);
}


async function waitForFirstPost(page, timeout, logger) {
    logStep(logger, "Чекаємо перший пост", {
        selector: firstAuthorPagePostSelector,
        timeout,
    });

    try {
        await page.waitForFunction(
            (selector) => Boolean(document.querySelector(selector)),
            { timeout },
            firstAuthorPagePostSelector
        );
    } catch (error) {
        throw createError(
            "Не знайдено перший пост автора за відведений час",
            "FACEBOOK_AUTHOR_PAGE_FIRST_POST_NOT_FOUND"
        );
    }
}


async function waitForDateLink(page, timeout, logger) {
    logStep(logger, "Одночасно чекаємо один із селекторів часу й дати", {
        permalinkSelector: firstAuthorPagePostPermalinkSelector,
        cftSelector: firstAuthorPagePostCftSelector,
        timeout,
    });

    try {
        await page.waitForFunction((permalinkSelector, cftSelector) => (
            Boolean(document.querySelector(permalinkSelector))
            || Boolean(document.querySelector(cftSelector))
        ), { timeout }, firstAuthorPagePostPermalinkSelector,
        firstAuthorPagePostCftSelector);
    } catch (error) {
        throw createError(
            "Не знайдено посилання часу й дати першого поста",
            "FACEBOOK_AUTHOR_PAGE_DATE_LINK_NOT_FOUND"
        );
    }

    const selected = await page.evaluate((permalinkSelector, cftSelector) => {
        if (document.querySelector(cftSelector)) return "cft";
        if (document.querySelector(permalinkSelector)) return "permalink";
        return null;
    }, firstAuthorPagePostPermalinkSelector, firstAuthorPagePostCftSelector);

    return selected === "cft"
        ? { variant: selected, selector: firstAuthorPagePostCftSelector }
        : { variant: "permalink", selector: firstAuthorPagePostPermalinkSelector };
}


export default async function openFacebookPostViaAuthorPage(
    page,
    {
        postUrl,
        timeout = 15000,
        logger = console,
    } = {}
) {
    const pageId = extractFacebookAuthorPageId(postUrl);
    const postId = extractFacebookPostId(postUrl);
    const result = {
        success: false,
        status: facebookPostViaAuthorPageStatuses.ERROR,
        pageId,
        postId,
        authorPageUrl: pageId
            ? `https://www.facebook.com/profile.php?id=${pageId}`
            : null,
        dateLink: null,
        finalUrl: null,
        openedPostId: null,
        error: null,
    };

    try {
        if (!page || typeof page.goto !== "function") {
            result.status = facebookPostViaAuthorPageStatuses.INVALID_INPUT;
            throw createError("Не передано Puppeteer-сторінку", "PAGE_INVALID");
        }

        if (!pageId) {
            result.status = facebookPostViaAuthorPageStatuses.PAGE_ID_NOT_FOUND;
            throw createError(
                "Не вдалося отримати ID автора з посилання на пост",
                "PAGE_ID_NOT_FOUND"
            );
        }

        if (!postId) {
            result.status = facebookPostViaAuthorPageStatuses.POST_ID_NOT_FOUND;
            throw createError(
                "Не вдалося отримати Facebook ID поста з посилання",
                "POST_ID_NOT_FOUND"
            );
        }

        logStep(logger, "Відкриваємо сторінку автора", {
            pageId,
            postId,
            url: result.authorPageUrl,
        });
        await openPageWithoutPopups(page, result.authorPageUrl, { timeout });
        await waitForFirstPost(page, timeout, logger);

        const dateLink = await waitForDateLink(page, timeout, logger);
        const highlight = await highlightDateLink(page, dateLink.selector);
        if (!highlight) {
            result.status = facebookPostViaAuthorPageStatuses.DATE_LINK_NOT_FOUND;
            throw createError(
                "Посилання часу й дати зникло перед підсвічуванням",
                "DATE_LINK_DISAPPEARED"
            );
        }

        result.dateLink = { ...dateLink, ...highlight };
        logStep(logger, "Знайдено і підсвічено червоним посилання часу й дати", {
            selector: dateLink.selector,
            variant: dateLink.variant,
            href: highlight.href,
            nextClickTarget: dateLink.selector,
        });

        const clickableSelector = createClickableDateLinkSelector(
            dateLink.selector
        );
        logStep(logger, "Клікаємо посилання часу й дати", {
            selector: dateLink.selector,
            clickableSelector,
            confirm: `Facebook ID ${postId} у URL`,
        });
        await clickUntilConfirmed(page, {
            target: { selector: clickableSelector },
            confirm: createOpenedPostUrlCheck(),
            description: "час і дату першого поста автора",
            timeout,
            confirmTimeout: timeout,
            onStep: createStepLogger(logger),
        });

        logStep(logger, "Чекаємо завантаження відкритого поста", {
            postId,
        });
        if (!await isPostAvailable(page, { logger })) {
            result.status = facebookPostViaAuthorPageStatuses.POST_NOT_OPENED;
            throw createError(
                "Після кліку не відкрився доступний пост",
                "FACEBOOK_AUTHOR_PAGE_POST_NOT_OPENED"
            );
        }

        result.finalUrl = page.url();
        result.openedPostId = extractFacebookPostId(result.finalUrl);
        if (!doesFacebookPostUrlMatch(result.finalUrl, postId)) {
            result.status = facebookPostViaAuthorPageStatuses.WRONG_POST_OPENED;
            throw createError(
                "Відкрито не той допис: Facebook ID у URL не збігається з переданим",
                "FACEBOOK_AUTHOR_PAGE_WRONG_POST_OPENED"
            );
        }

        result.success = true;
        result.status = facebookPostViaAuthorPageStatuses.OPENED;
        logStep(logger, "Пост відкрито після кліку по часу й даті", {
            finalUrl: result.finalUrl,
            postId,
        });
    } catch (error) {
        if (result.status === facebookPostViaAuthorPageStatuses.ERROR) {
            result.status = error?.code === "FACEBOOK_AUTHOR_PAGE_FIRST_POST_NOT_FOUND"
                ? facebookPostViaAuthorPageStatuses.FIRST_POST_NOT_FOUND
                : error?.code === "BROWSER_CLICK_NOT_CONFIRMED"
                    ? facebookPostViaAuthorPageStatuses.POST_NOT_OPENED
                : facebookPostViaAuthorPageStatuses.DATE_LINK_NOT_FOUND;
        }
        result.error = { code: error?.code ?? null, message: error.message };
        logStep(logger, "Дію завершено помилкою", {
            status: result.status,
            code: error?.code ?? null,
            message: error.message,
        });
    }

    result.finalUrl ??= typeof page?.url === "function" ? page.url() : null;

    return result;
}
