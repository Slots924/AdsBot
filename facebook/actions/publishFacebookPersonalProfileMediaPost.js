import { stat } from "node:fs/promises";
import path from "node:path";

import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import {
    personalProfileAudienceDoneButtonSelector,
    personalProfileAudienceRadioSelector,
    personalProfileComposerButtonCandidatesSelector,
    personalProfileCreatePostDialogSelector,
    personalProfilePhotoVideoButtonSelector,
    personalProfilePostPrivacyButtonSelector,
    personalProfilePublishPostButtonSelector,
} from "../selectors/personalProfilePost.js";


const fileChooserTimeout = 15000;
const supportedMediaExtensions = new Set([
    ".avi", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg",
    ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".png",
    ".tif", ".tiff", ".webm", ".webp", ".wmv",
]);

export const facebookPersonalProfileMediaPostStatuses = Object.freeze({
    PUBLISHED: "PUBLISHED",
    INVALID_INPUT: "INVALID_INPUT",
    ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
    PRIVACY_FAILED: "PRIVACY_FAILED",
    UPLOAD_FAILED: "UPLOAD_FAILED",
    PUBLISH_FAILED: "PUBLISH_FAILED",
    ERROR: "ERROR",
});


class PersonalProfileMediaPostError extends Error {
    constructor(message, {
        code,
        status,
        stage,
        selector = null,
        cause = null,
    }) {
        super(message, cause ? { cause } : undefined);
        this.name = "PersonalProfileMediaPostError";
        this.code = code;
        this.status = status;
        this.stage = stage;
        this.selector = selector;
    }
}


function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}


function normalizeFacebookPostUrl(value) {
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

        if (url.pathname.toLocaleLowerCase().endsWith("/photo/")) {
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


function extractFacebookPostId(postUrl) {
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


async function readVisiblePostPermalinks(page) {
    const candidates = await page.evaluate(() => {
        const visible = (node) => {
            const rectangle = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        };
        return Array.from(document.querySelectorAll(
            'div[role="main"] a[href*="story_fbid"], '
            + 'div[role="main"] a[href*="/posts/"], '
            + 'div[role="main"] a[href*="/videos/"]'
        ))
            .filter(visible)
            .map((anchor) => ({
                href: anchor.href,
                text: String(anchor.innerText ?? "")
                    .replace(/\s+/g, " ")
                    .trim(),
                top: anchor.getBoundingClientRect().top,
            }))
            .sort((left, right) => left.top - right.top);
    });

    return candidates
        .map((candidate) => ({
            ...candidate,
            href: normalizeFacebookPostUrl(candidate.href),
        }))
        .filter((candidate) => candidate.href);
}


async function waitForNewPostPermalink(
    page,
    previousPermalinks,
    timeout,
    sleep
) {
    const known = new Set(previousPermalinks);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        const candidates = await readVisiblePostPermalinks(page);
        const createdPost = candidates.find(({ href }) => !known.has(href));
        if (createdPost) return createdPost.href;

        await (sleep
            ? sleep(250)
            : new Promise((resolve) => setTimeout(resolve, 250)));
    }

    return null;
}


async function validateMediaPaths(mediaPaths) {
    if (!Array.isArray(mediaPaths) || mediaPaths.length === 0) {
        throw new PersonalProfileMediaPostError(
            "Потрібно передати хоча б один шлях до фото або відео",
            {
                code: "FACEBOOK_PERSONAL_POST_MEDIA_REQUIRED",
                status: facebookPersonalProfileMediaPostStatuses.INVALID_INPUT,
                stage: "VALIDATE_INPUT",
            }
        );
    }

    const absolutePaths = mediaPaths.map((mediaPath) => path.resolve(mediaPath));

    for (const absolutePath of absolutePaths) {
        const extension = path.extname(absolutePath).toLocaleLowerCase();

        if (!supportedMediaExtensions.has(extension)) {
            throw new PersonalProfileMediaPostError(
                `Непідтримуваний формат медіафайлу: ${extension || "без розширення"}`,
                {
                    code: "FACEBOOK_PERSONAL_POST_MEDIA_UNSUPPORTED",
                    status: facebookPersonalProfileMediaPostStatuses.INVALID_INPUT,
                    stage: "VALIDATE_INPUT",
                }
            );
        }

        let details;

        try {
            details = await stat(absolutePath);
        } catch (error) {
            throw new PersonalProfileMediaPostError(
                `Не вдалося прочитати медіафайл: ${absolutePath}`,
                {
                    code: "FACEBOOK_PERSONAL_POST_MEDIA_NOT_FOUND",
                    status: facebookPersonalProfileMediaPostStatuses.INVALID_INPUT,
                    stage: "VALIDATE_INPUT",
                    cause: error,
                }
            );
        }

        if (!details.isFile() || details.size === 0) {
            throw new PersonalProfileMediaPostError(
                `Некоректний або порожній медіафайл: ${absolutePath}`,
                {
                    code: "FACEBOOK_PERSONAL_POST_MEDIA_INVALID",
                    status: facebookPersonalProfileMediaPostStatuses.INVALID_INPUT,
                    stage: "VALIDATE_INPUT",
                }
            );
        }
    }

    return absolutePaths;
}


async function findVisibleElementByText(page, selector, expectedText) {
    const elements = await page.$$(selector);
    const normalizedExpectedText = normalizeText(expectedText);
    let matchedElement = null;

    for (const element of elements) {
        try {
            const text = await element.evaluate((node) => {
                if (node.matches('input[type="radio"]')) {
                    return node.parentElement?.parentElement?.parentElement
                        ?.innerText ?? "";
                }

                return node.innerText ?? "";
            });
            const firstLine = String(text).split(/\r?\n/)[0];
            const rectangle = await element.boundingBox();

            if (
                normalizeText(firstLine) === normalizedExpectedText
                && rectangle
            ) {
                matchedElement = element;
                break;
            }
        } catch {
            // React міг замінити елемент під час перевірки.
        }
    }

    await Promise.all(elements
        .filter((element) => element !== matchedElement)
        .map((element) => element.dispose().catch(() => {})));

    return matchedElement;
}


async function clickElement(page, element, timingOptions) {
    try {
        await humanClickElement(page, element, {
            beforeDelay: [100, 260],
            holdDelay: [80, 170],
            scrollDelay: [900, 1600],
            ...timingOptions,
        });
    } finally {
        await element.dispose().catch(() => {});
    }
}


async function clickVisibleSelector(
    page,
    selector,
    timeout,
    timingOptions,
    stabilization = "long"
) {
    const initialElement = await waitForVisibleElement(page, selector, {
        timeout,
    });
    await initialElement.dispose().catch(() => {});
    await waitHuman(stabilization, timingOptions);
    const element = await waitForVisibleElement(page, selector, { timeout });
    await clickElement(page, element, timingOptions);
}


async function clickVisibleText(
    page,
    selector,
    expectedText,
    timeout,
    timingOptions
) {
    await page.waitForFunction(
        (targetSelector, targetText) => Array.from(
            document.querySelectorAll(targetSelector)
        ).some((element) => {
            const rectangle = element.getBoundingClientRect();
            const rawText = element.matches('input[type="radio"]')
                ? element.parentElement?.parentElement?.parentElement
                    ?.innerText ?? ""
                : element.innerText ?? "";
            const text = String(rawText).split(/\r?\n/)[0]
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();

            return rectangle.width > 0
                && rectangle.height > 0
                && text === targetText.toLocaleLowerCase();
        }),
        { timeout },
        selector,
        expectedText
    );
    await waitHuman("medium", timingOptions);
    const element = await findVisibleElementByText(
        page,
        selector,
        expectedText
    );

    if (!element) {
        throw new Error(`Елемент з текстом «${expectedText}» зник`);
    }

    await clickElement(page, element, timingOptions);
}


async function readAudience(page) {
    return page.evaluate((selector) => {
        const button = document.querySelector(selector);
        return String(button?.innerText ?? "").replace(/\s+/g, " ").trim();
    }, personalProfilePostPrivacyButtonSelector);
}


async function ensurePublicAudience(page, timeout, timingOptions) {
    if (normalizeText(await readAudience(page)) === "public") {
        return;
    }

    await clickVisibleSelector(
        page,
        personalProfilePostPrivacyButtonSelector,
        timeout,
        timingOptions,
        "medium"
    );
    await clickVisibleText(
        page,
        personalProfileAudienceRadioSelector,
        "Public",
        timeout,
        timingOptions
    );
    await clickVisibleSelector(
        page,
        personalProfileAudienceDoneButtonSelector,
        timeout,
        timingOptions,
        "medium"
    );
    await waitForVisibleElement(
        page,
        personalProfilePostPrivacyButtonSelector,
        { timeout }
    ).then((element) => element.dispose());

    try {
        await page.waitForFunction(
            (selector, expectedAudience) => {
                const button = document.querySelector(selector);
                const audience = String(button?.innerText ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase();

                return audience === expectedAudience.toLocaleLowerCase();
            },
            { timeout },
            personalProfilePostPrivacyButtonSelector,
            "Public"
        );
    } catch (error) {
        throw new PersonalProfileMediaPostError(
            "Не вдалося дочекатися публічної аудиторії допису",
            {
                code: "FACEBOOK_PERSONAL_POST_PUBLIC_TIMEOUT",
                status: facebookPersonalProfileMediaPostStatuses.PRIVACY_FAILED,
                stage: "ENSURE_PUBLIC",
                selector: personalProfilePostPrivacyButtonSelector,
                cause: error,
            }
        );
    }
    await waitHuman("medium", timingOptions);

    if (normalizeText(await readAudience(page)) !== "public") {
        throw new PersonalProfileMediaPostError(
            "Не вдалося підтвердити публічну аудиторію допису",
            {
                code: "FACEBOOK_PERSONAL_POST_NOT_PUBLIC",
                status: facebookPersonalProfileMediaPostStatuses.PRIVACY_FAILED,
                stage: "ENSURE_PUBLIC",
                selector: personalProfilePostPrivacyButtonSelector,
            }
        );
    }
}


export default async function publishFacebookPersonalProfileMediaPost(
    page,
    {
        mediaPaths,
        timeout = 90000,
        random = Math.random,
        sleep,
        capturePostUrl = false,
    } = {}
) {
    const startedAt = new Date().toISOString();
    let stage = "VALIDATE_INPUT";
    let absolutePaths = [];
    let postUrl = null;
    let previousPermalinks = [];

    try {
        if (!page || typeof page.url !== "function") {
            throw new PersonalProfileMediaPostError(
                "Потрібна активна Puppeteer-сторінка",
                {
                    code: "FACEBOOK_PERSONAL_POST_PAGE_REQUIRED",
                    status: facebookPersonalProfileMediaPostStatuses.INVALID_INPUT,
                    stage,
                }
            );
        }

        absolutePaths = await validateMediaPaths(mediaPaths);
        const timingOptions = { random, ...(sleep ? { sleep } : {}) };

        stage = "OPEN_COMPOSER";
        await clickVisibleText(
            page,
            personalProfileComposerButtonCandidatesSelector,
            "What's on your mind?",
            timeout,
            timingOptions
        );
        await waitForVisibleElement(
            page,
            personalProfileCreatePostDialogSelector,
            { timeout }
        ).then((element) => element.dispose());
        await waitHuman("long", timingOptions);

        stage = "ENSURE_PUBLIC";
        await ensurePublicAudience(page, timeout, timingOptions);

        stage = "UPLOAD_MEDIA";
        const chooserPromise = page.waitForFileChooser({
            timeout: fileChooserTimeout,
        });
        const clickPromise = clickVisibleSelector(
            page,
            personalProfilePhotoVideoButtonSelector,
            timeout,
            timingOptions
        );
        const [chooserResult, clickResult] = await Promise.allSettled([
            chooserPromise,
            clickPromise,
        ]);

        if (clickResult.status === "rejected") throw clickResult.reason;
        if (chooserResult.status === "rejected") throw chooserResult.reason;
        await chooserResult.value.accept(absolutePaths);

        await page.waitForFunction(
            (selector) => {
                const button = document.querySelector(selector);
                return button
                    && button.getAttribute("aria-disabled") !== "true";
            },
            { timeout },
            personalProfilePublishPostButtonSelector
        );
        await waitHuman("long", timingOptions);
        await page.waitForFunction(
            (selector) => {
                const button = document.querySelector(selector);
                return button
                    && button.getAttribute("aria-disabled") !== "true";
            },
            { timeout },
            personalProfilePublishPostButtonSelector
        );

        stage = "VERIFY_PUBLIC";
        if (normalizeText(await readAudience(page)) !== "public") {
            throw new PersonalProfileMediaPostError(
                "Аудиторія змінилася перед публікацією; допис не надіслано",
                {
                    code: "FACEBOOK_PERSONAL_POST_PUBLIC_LOST",
                    status: facebookPersonalProfileMediaPostStatuses.PRIVACY_FAILED,
                    stage,
                    selector: personalProfilePostPrivacyButtonSelector,
                }
            );
        }

        stage = "PUBLISH";
        if (capturePostUrl) {
            previousPermalinks = (await readVisiblePostPermalinks(page))
                .map(({ href }) => href);
        }
        await clickVisibleSelector(
            page,
            personalProfilePublishPostButtonSelector,
            timeout,
            timingOptions,
            "medium"
        );
        await page.waitForFunction(
            (selector) => !document.querySelector(selector),
            { timeout },
            personalProfileCreatePostDialogSelector
        );

        if (capturePostUrl) {
            stage = "CAPTURE_POST_URL";
            console.log("Чекаємо стабілізації перед пошуком нового permalink (щоб пост з'явився в фіді)");
            await waitHuman("long", timingOptions);
            console.log("Починаємо пошук нового post URL");
            postUrl = await waitForNewPostPermalink(
                page,
                previousPermalinks,
                Math.min(timeout, 30000),
                sleep
            );
        }

        return {
            success: true,
            status: facebookPersonalProfileMediaPostStatuses.PUBLISHED,
            stage: "COMPLETED",
            mediaPaths: absolutePaths,
            mediaCount: absolutePaths.length,
            audience: "Public",
            postUrl,
            postId: extractFacebookPostId(postUrl),
            postUrlCaptured: Boolean(postUrl),
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: page.url(),
            error: null,
        };
    } catch (error) {
        const normalizedError = error instanceof PersonalProfileMediaPostError
            ? error
            : new PersonalProfileMediaPostError(error.message, {
                code: `FACEBOOK_PERSONAL_POST_${stage}_FAILED`,
                status: stage === "UPLOAD_MEDIA"
                    ? facebookPersonalProfileMediaPostStatuses.UPLOAD_FAILED
                    : stage === "PUBLISH"
                        ? facebookPersonalProfileMediaPostStatuses.PUBLISH_FAILED
                        : facebookPersonalProfileMediaPostStatuses.ELEMENT_NOT_FOUND,
                stage,
                cause: error,
            });

        return {
            success: false,
            status: normalizedError.status,
            stage: normalizedError.stage,
            mediaPaths: absolutePaths,
            mediaCount: absolutePaths.length,
            audience: null,
            postUrl,
            postId: extractFacebookPostId(postUrl),
            postUrlCaptured: Boolean(postUrl),
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: typeof page?.url === "function" ? page.url() : null,
            error: {
                code: normalizedError.code,
                message: normalizedError.message,
                selector: normalizedError.selector,
            },
        };
    }
}
