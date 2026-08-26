import {
    clickUntilConfirmed,
    clickWhenStable,
    describeLocator,
    waitForDomQuiet,
} from "../browser/confirmedClick.js";
import { waitForVisibleElement } from "../browser/elements.js";
import {
    getPersonalProfileFeedPostActionsButtonSelector,
    getPersonalProfileFeedPostSelector,
    personalProfileFeedPostActionButtonSelector,
    personalProfileFeedPostMenuItemSelector,
    personalProfileMoveToTrashButtonSelector,
} from "../selectors/personalProfileFeedPosts.js";


const postSearchTimeout = 5000;
const menuActionTimeout = 15000;
const hideConfirmTimeout = 15000;
const maxPostsToClean = 20;
const moveToTrashText = "Move to trash";
const hideFromProfileText = "Hide from profile";

export const facebookPersonalProfilePostDeletionStatuses = Object.freeze({
    CLEANED: "CLEANED",
    NO_POSTS: "NO_POSTS",
    SYSTEM_POSTS_REMAIN: "SYSTEM_POSTS_REMAIN",
    ORDINARY_POSTS_REMAIN: "ORDINARY_POSTS_REMAIN",
    MIXED_POSTS_REMAIN: "MIXED_POSTS_REMAIN",
    INVALID_INPUT: "INVALID_INPUT",
    ELEMENT_NOT_FOUND: "ELEMENT_NOT_FOUND",
    HIDE_FAILED: "HIDE_FAILED",
    DELETE_FAILED: "DELETE_FAILED",
    VERIFICATION_FAILED: "VERIFICATION_FAILED",
    ERROR: "ERROR",
});


class PersonalProfilePostDeletionError extends Error {
    constructor(message, {
        code,
        status,
        stage,
        selector = null,
        timeoutMs = null,
        cause = null,
    }) {
        super(message, cause ? { cause } : undefined);
        this.name = "PersonalProfilePostDeletionError";
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
            `[deleteAllFacebookPersonalProfilePosts] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


export function readPostSnapshotInPage(posinset) {
    const post = document.querySelector(`[aria-posinset="${posinset}"]`);

    if (!post) {
        return null;
    }

    const link = post.querySelector(
        'a[href*="story_fbid"], a[href*="/posts/"], a[href*="/photo/"]'
    );
    const images = Array.from(post.querySelectorAll("img"))
        .map((image) => image.currentSrc || image.getAttribute("src"))
        .filter(Boolean)
        .slice(0, 3);

    return {
        href: link?.href ?? null,
        text: String(post.innerText ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500),
        images,
    };
}


export function detectPostMenuActionInPage() {
    const normalize = (value) => String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const visible = (element) => {
        if (!element) {
            return false;
        }

        const rectangle = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return rectangle.width > 0
            && rectangle.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0";
    };
    const trash = Array.from(
        document.querySelectorAll('[role="menu"] [role="menuitem"]')
    ).find((element) =>
        visible(element)
        && normalize(element.innerText).includes("move to trash")
    );

    if (trash) {
        return "trash";
    }

    const hide = Array.from(
        document.querySelectorAll('[role="button"]')
    ).find((element) =>
        visible(element)
        && normalize(element.textContent).includes("hide from profile")
    );

    return hide ? "hide" : null;
}


export function isFeedPostHiddenInPage(posinset) {
    const post = document.querySelector(`[aria-posinset="${posinset}"]`);

    if (!post) {
        return false;
    }

    return Array.from(post.querySelectorAll('[role="button"]')).some(
        (element) => {
            const text = String(element.textContent ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();

            return text === "undo" || text.includes("unhide post");
        }
    );
}


async function readPostSnapshot(page, posinset) {
    return page.evaluate(readPostSnapshotInPage, posinset);
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
        throw new PersonalProfilePostDeletionError(error.message, {
            code: error?.code === "BROWSER_CLICK_NOT_CONFIRMED"
                ? "FACEBOOK_PERSONAL_DELETE_INTERACTION_FAILED"
                : "FACEBOOK_PERSONAL_DELETE_SELECTOR_TIMEOUT",
            status: facebookPersonalProfilePostDeletionStatuses.ELEMENT_NOT_FOUND,
            stage,
            selector: error?.selector ?? selector,
            timeoutMs: error?.timeoutMs ?? timeout,
            cause: error,
        });
    }
}


async function clickStable(
    page,
    options,
    { timeout, report, stage, timingOptions }
) {
    const selector = describeLocator(options.target);

    try {
        return await clickWhenStable(page, {
            ...options,
            timeout,
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
        throw new PersonalProfilePostDeletionError(error.message, {
            code: "FACEBOOK_PERSONAL_DELETE_SELECTOR_TIMEOUT",
            status: facebookPersonalProfilePostDeletionStatuses.ELEMENT_NOT_FOUND,
            stage,
            selector: error?.selector ?? selector,
            timeoutMs: error?.timeoutMs ?? timeout,
            cause: error,
        });
    }
}


async function waitForFeedPost(page, posinset, timeout) {
    const selector = getPersonalProfileFeedPostSelector(posinset);

    try {
        const element = await waitForVisibleElement(page, selector, {
            timeout,
        });
        await element.dispose().catch(() => {});
        return true;
    } catch {
        return false;
    }
}


async function waitForMenuAction(page, timeout) {
    let handle;

    try {
        handle = await page.waitForFunction(
            detectPostMenuActionInPage,
            { timeout }
        );
        return await handle.jsonValue();
    } catch {
        return null;
    } finally {
        await handle?.dispose().catch(() => {});
    }
}


async function openPostActionsMenu(
    page,
    posinset,
    { timeout, report, stage, timingOptions }
) {
    const selector = getPersonalProfileFeedPostActionsButtonSelector(posinset);
    let lastAction = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        report(stage, `Відкриваємо меню поста ${posinset}`, {
            selector,
            attempt,
        });
        await clickStable(
            page,
            {
                target: { selector },
                description: "Actions for this post",
            },
            {
                timeout,
                report,
                stage,
                timingOptions,
            }
        );

        lastAction = await waitForMenuAction(page, menuActionTimeout);

        if (lastAction) {
            await waitForDomQuiet(page, {
                selector: lastAction === "trash"
                    ? personalProfileFeedPostMenuItemSelector
                    : personalProfileFeedPostActionButtonSelector,
            });
            return lastAction;
        }
    }

    throw new PersonalProfilePostDeletionError(
        "Після кліку по меню поста не з’явились Move to trash або Hide from profile",
        {
            code: "FACEBOOK_PERSONAL_DELETE_MENU_ACTION_NOT_FOUND",
            status: facebookPersonalProfilePostDeletionStatuses.ELEMENT_NOT_FOUND,
            stage,
            selector,
            timeoutMs: menuActionTimeout,
        }
    );
}


async function waitForPostSnapshotChange(
    page,
    posinset,
    previousSnapshot,
    timeout
) {
    await page.waitForFunction(
        (position, previous) => {
            const post = document.querySelector(`[aria-posinset="${position}"]`);

            if (!post) {
                return true;
            }

            const link = post.querySelector(
                'a[href*="story_fbid"], a[href*="/posts/"], a[href*="/photo/"]'
            );
            const images = Array.from(post.querySelectorAll("img"))
                .map((image) => image.currentSrc || image.getAttribute("src"))
                .filter(Boolean)
                .slice(0, 3);
            const current = {
                href: link?.href ?? null,
                text: String(post.innerText ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 500),
                images,
            };

            return JSON.stringify(current) !== JSON.stringify(previous);
        },
        { timeout },
        posinset,
        previousSnapshot
    );
}


async function movePostToTrash(
    page,
    posinset,
    previousSnapshot,
    { timeout, report, stage, timingOptions }
) {
    await clickUntilNextVisible(
        page,
        {
            target: {
                candidateSelector: personalProfileFeedPostMenuItemSelector,
                expectedText: moveToTrashText,
                match: "includes",
            },
            confirm: {
                selector: personalProfileMoveToTrashButtonSelector,
            },
            description: "Move to trash",
        },
        {
            timeout,
            report,
            stage,
            timingOptions,
        }
    );
    await clickStable(
        page,
        {
            target: {
                selector: personalProfileMoveToTrashButtonSelector,
            },
            description: "Move",
        },
        {
            timeout,
            report,
            stage,
            timingOptions,
        }
    );

    try {
        await waitForPostSnapshotChange(
            page,
            posinset,
            previousSnapshot,
            timeout
        );
    } catch (error) {
        throw new PersonalProfilePostDeletionError(
            "Після Move пост 1 не змінився",
            {
                code: "FACEBOOK_PERSONAL_DELETE_SNAPSHOT_UNCHANGED",
                status: facebookPersonalProfilePostDeletionStatuses.DELETE_FAILED,
                stage,
                selector: getPersonalProfileFeedPostSelector(posinset),
                timeoutMs: timeout,
                cause: error,
            }
        );
    }
}


async function hidePostFromProfile(
    page,
    posinset,
    { timeout, report, stage, timingOptions }
) {
    await clickStable(
        page,
        {
            target: {
                candidateSelector: personalProfileFeedPostActionButtonSelector,
                expectedText: hideFromProfileText,
                match: "includes",
            },
            description: "Hide from profile",
        },
        {
            timeout,
            report,
            stage,
            timingOptions,
        }
    );

    try {
        const handle = await page.waitForFunction(
            isFeedPostHiddenInPage,
            { timeout: hideConfirmTimeout },
            posinset
        );
        await handle.dispose().catch(() => {});
    } catch (error) {
        throw new PersonalProfilePostDeletionError(
            "Після Hide from profile пост не став прихованим",
            {
                code: "FACEBOOK_PERSONAL_DELETE_HIDE_NOT_CONFIRMED",
                status: facebookPersonalProfilePostDeletionStatuses.HIDE_FAILED,
                stage,
                selector: getPersonalProfileFeedPostSelector(posinset),
                timeoutMs: hideConfirmTimeout,
                cause: error,
            }
        );
    }
}


export default async function deleteAllFacebookPersonalProfilePosts(
    page,
    {
        timeout = 90000,
        random = Math.random,
        sleep,
        logger = console,
        onProgress = null,
    } = {}
) {
    const startedAt = new Date().toISOString();
    let stage = "VALIDATE_INPUT";
    const report = (
        currentStage,
        message,
        details = {},
        { level = "info", event = "facebook.personal_posts.step" } = {}
    ) => {
        emitLog(logger, level, event, message, {
            stage: currentStage,
            currentUrl: typeof page?.url === "function" ? page.url() : null,
            ...details,
        });
    };
    const timingOptions = {
        random,
        ...(sleep ? { sleep } : {}),
    };
    let deletedCount = 0;
    let hiddenCount = 0;
    let processedCount = 0;

    const finish = (status, extra = {}) => {
        const success = status
            === facebookPersonalProfilePostDeletionStatuses.CLEANED
            || status === facebookPersonalProfilePostDeletionStatuses.NO_POSTS;

        report(
            extra.stage ?? stage,
            success
                ? "Очищення постів особистого профілю завершено"
                : "Очищення постів особистого профілю завершилося з помилкою",
            {
                status,
                deletedCount,
                hiddenCount,
                processedCount,
                error: extra.error ?? null,
            },
            {
                level: success ? "info" : "error",
                event: success
                    ? "facebook.personal_posts.completed"
                    : "facebook.personal_posts.failed",
            }
        );

        return {
            success,
            status,
            stage: extra.stage ?? stage,
            deletedCount,
            hiddenCount,
            processedCount,
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: typeof page?.url === "function" ? page.url() : null,
            error: extra.error ?? null,
        };
    };

    try {
        if (!page || typeof page.url !== "function") {
            throw new PersonalProfilePostDeletionError(
                "Потрібна активна Puppeteer-сторінка",
                {
                    code: "FACEBOOK_PERSONAL_DELETE_PAGE_REQUIRED",
                    status:
                        facebookPersonalProfilePostDeletionStatuses.INVALID_INPUT,
                    stage,
                }
            );
        }

        if (!Number.isFinite(timeout) || timeout <= 0) {
            throw new PersonalProfilePostDeletionError(
                "timeout має бути додатним числом",
                {
                    code: "FACEBOOK_PERSONAL_DELETE_TIMEOUT_INVALID",
                    status:
                        facebookPersonalProfilePostDeletionStatuses.INVALID_INPUT,
                    stage,
                }
            );
        }

        let posinset = 1;

        while (processedCount < maxPostsToClean) {
            stage = "FIND_FEED_POST";
            report(stage, `Шукаємо пост ${posinset}`, {
                posinset,
                timeout: postSearchTimeout,
            });

            const postFound = await waitForFeedPost(
                page,
                posinset,
                postSearchTimeout
            );

            if (!postFound) {
                return finish(
                    processedCount === 0
                        ? facebookPersonalProfilePostDeletionStatuses.NO_POSTS
                        : facebookPersonalProfilePostDeletionStatuses.CLEANED,
                    { stage: "COMPLETED" }
                );
            }

            const alreadyHidden = await page.evaluate(
                isFeedPostHiddenInPage,
                posinset
            );

            if (alreadyHidden) {
                report(stage, `Пост ${posinset} уже прихований, беремо наступний`, {
                    posinset,
                });
                posinset += 1;
                continue;
            }

            const snapshot = await readPostSnapshot(page, posinset);
            stage = "OPEN_POST_MENU";
            const action = await openPostActionsMenu(page, posinset, {
                timeout,
                report,
                stage,
                timingOptions,
            });

            if (action === "trash") {
                stage = "MOVE_POST_TO_TRASH";
                await movePostToTrash(page, posinset, snapshot, {
                    timeout,
                    report,
                    stage,
                    timingOptions,
                });
                deletedCount += 1;
                processedCount += 1;
                posinset = 1;

                if (typeof onProgress === "function") {
                    await onProgress({
                        type: "post_moved_to_trash",
                        processedCount,
                        deletedCount,
                    });
                }
                continue;
            }

            stage = "HIDE_POST_FROM_PROFILE";
            await hidePostFromProfile(page, posinset, {
                timeout,
                report,
                stage,
                timingOptions,
            });
            hiddenCount += 1;
            processedCount += 1;
            posinset += 1;

            if (typeof onProgress === "function") {
                await onProgress({
                    type: "post_hidden",
                    processedCount,
                    hiddenCount,
                    nextPosinset: posinset,
                });
            }
        }

        return finish(
            facebookPersonalProfilePostDeletionStatuses.CLEANED,
            { stage: "COMPLETED" }
        );
    } catch (error) {
        const normalized = error instanceof PersonalProfilePostDeletionError
            ? error
            : new PersonalProfilePostDeletionError(
                error?.message ?? String(error),
                {
                    code: error?.code
                        ?? `FACEBOOK_PERSONAL_DELETE_${stage}_FAILED`,
                    status: facebookPersonalProfilePostDeletionStatuses.ERROR,
                    stage,
                    cause: error,
                }
            );

        return finish(normalized.status, {
            stage: normalized.stage,
            error: {
                code: normalized.code,
                message: normalized.message,
                selector: normalized.selector,
            },
        });
    }
}
