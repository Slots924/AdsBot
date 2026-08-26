// Стара функція: видалення постів через діалог Manage posts.

import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../browser/elements.js";
import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import {
    randomInteger,
    waitHuman,
    waitRandom,
} from "../browser/timing.js";
import {
    personalProfileDeleteConfirmationButtonCandidatesSelector,
    personalProfileManagePostsActionRadioSelector,
    personalProfileManagePostsButtonCandidatesSelector,
    personalProfileManagePostsButtonSelector,
    personalProfileManagePostsCheckboxSelector,
    personalProfileManagePostsCloseButtonSelector,
    personalProfileManagePostsDialogSelector,
    personalProfileManagePostsDoneButtonSelector,
    personalProfileManagePostsNextButtonSelector,
} from "../selectors/personalProfileManagePosts.js";
import openPageWithoutPopups from "./openPageWithoutPopups.js";


const selectionLimit = 50;
const stableScrollRoundsRequired = 3;

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
        cause = null,
    }) {
        super(message, cause ? { cause } : undefined);
        this.name = "PersonalProfilePostDeletionError";
        this.code = code;
        this.status = status;
        this.stage = stage;
        this.selector = selector;
    }
}


function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
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
            `[deleteAllFacebookPersonalProfilePosts] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


function reportInteraction(timingOptions, event, message, fields = {}, level = "info") {
    timingOptions.report?.(event, message, fields, level);
}


async function emitProgress(onProgress, event) {
    if (typeof onProgress !== "function") return;

    try {
        await onProgress(event);
    } catch {
        // Помилка зовнішнього progress callback не повинна зупиняти browser action.
    }
}


async function readElementDetails(element) {
    return element.evaluate((node) => {
        const normalize = (value) => String(value ?? "")
            .replace(/\s+/g, " ")
            .trim();
        const rectangle = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const labelledBy = node.getAttribute("aria-labelledby");
        const accessibleName = node.getAttribute("aria-label")
            || String(labelledBy ?? "")
                .split(/\s+/)
                .filter(Boolean)
                .map((id) => document.getElementById(id)?.innerText ?? "")
                .join(" ")
            || node.innerText
            || "";
        let section = node.parentElement;

        while (section && section.getAttribute("role") !== "dialog") {
            if (
                section.hasAttribute("aria-label")
                && section.querySelector('input[type="checkbox"]')
            ) break;
            section = section.parentElement;
        }
        let postContainer = node.parentElement;
        let permalink = null;

        while (postContainer && postContainer.getAttribute("role") !== "dialog") {
            permalink = postContainer.querySelector(
                'a[href*="story_fbid"], a[href*="/posts/"], '
                + 'a[href*="/photo/"]'
            );
            if (permalink) break;
            postContainer = postContainer.parentElement;
        }
        const postText = normalize([
            postContainer?.innerText,
            ...Array.from(postContainer?.querySelectorAll("a[aria-label]") ?? [])
                .map((anchor) => anchor.getAttribute("aria-label")),
        ].join(" "));
        const systemPost = /updated\b[\s\S]*\b(profile picture|cover photo)\b/i
            .test(postText);

        return {
            visible: rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0",
            text: normalize(node.innerText),
            accessibleName: normalize(accessibleName),
            checked: node.getAttribute("aria-checked"),
            disabled: node.getAttribute("aria-disabled") === "true",
            sectionKey: normalize(
                section?.getAttribute("aria-label")
                || section?.querySelector("h2")?.innerText
                || "unknown section"
            ),
            postKey: permalink?.href || postText.slice(0, 300),
            systemPost,
        };
    });
}


async function findVisibleElement(page, selector, predicate) {
    const elements = await page.$$(selector);
    let match = null;
    let details = null;

    for (const element of elements) {
        try {
            const currentDetails = await readElementDetails(element);

            if (currentDetails.visible && predicate(currentDetails)) {
                match = element;
                details = currentDetails;
                break;
            }
        } catch {
            // React міг замінити DOM-вузол під час читання.
        }
    }

    await Promise.all(elements
        .filter((element) => element !== match)
        .map((element) => element.dispose().catch(() => {})));

    return match ? { element: match, details } : null;
}


async function waitForMatchingElement(page, selector, expectedText, {
    timeout,
    useAccessibleName = false,
    requireEnabled = false,
    matchPrefix = false,
} = {}) {
    await page.waitForFunction(
        (targetSelector, targetText, accessible, enabled, prefix) => {
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
            const accessibleName = (node) => {
                const labelledBy = node.getAttribute("aria-labelledby");

                return node.getAttribute("aria-label")
                    || String(labelledBy ?? "")
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((id) => document.getElementById(id)?.innerText ?? "")
                        .join(" ")
                    || node.innerText
                    || "";
            };

            return Array.from(document.querySelectorAll(targetSelector))
                .some((node) => {
                    const value = accessible
                        ? accessibleName(node)
                        : node.innerText;

                    const normalizedValue = normalize(value);
                    const normalizedTarget = normalize(targetText);
                    const textMatches = prefix
                        ? normalizedValue.startsWith(normalizedTarget)
                        : normalizedValue === normalizedTarget;

                    return visible(node)
                        && textMatches
                        && (!enabled
                            || node.getAttribute("aria-disabled") !== "true");
                });
        },
        { timeout },
        selector,
        expectedText,
        useAccessibleName,
        requireEnabled,
        matchPrefix
    );
}


async function clickVerifiedElement(page, element, timingOptions, {
    beforeDelay = [50, 120],
    holdDelay = [70, 140],
    scrollDelay = [250, 550],
} = {}) {
    const movement = await moveMouseToElement(page, element, {
        scrollDelay,
        ...timingOptions,
    });
    const targetStillUnderPointer = await page.evaluate(
        (target, x, y) => {
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && (hit === target || target.contains(hit)));
        },
        element,
        movement.x,
        movement.y
    );

    if (!targetStillUnderPointer) {
        reportInteraction(
            timingOptions,
            "facebook.personal_posts.click.cancelled",
            "Елемент змістився після наведення; небезпечний клік скасовано",
            { x: movement.x, y: movement.y },
            "warn"
        );
        const error = new Error(
            "Facebook змінив розмітку після наведення; клік скасовано"
        );
        error.code = "FACEBOOK_PERSONAL_DELETE_TARGET_MOVED";
        throw error;
    }

    reportInteraction(
        timingOptions,
        "facebook.personal_posts.click.target_verified",
        "Перевірено ціль безпосередньо перед кліком",
        { x: movement.x, y: movement.y }
    );
    const result = await clickLeftMouse(page, {
        beforeDelay,
        holdDelay,
        ...timingOptions,
    });
    reportInteraction(
        timingOptions,
        "facebook.personal_posts.click.completed",
        "Human-like клік виконано",
        { x: movement.x, y: movement.y }
    );
    return result;
}


async function clickFreshMatch(
    page,
    selector,
    expectedText,
    timeout,
    timingOptions,
    {
        useAccessibleName = false,
        requireEnabled = false,
        matchPrefix = false,
        stabilization = "medium",
    } = {}
) {
    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.search",
        `Шукаємо елемент «${expectedText}»`,
        { selector, expectedText }
    );
    await waitForMatchingElement(page, selector, expectedText, {
        timeout,
        useAccessibleName,
        requireEnabled,
        matchPrefix,
    });
    await waitHuman(stabilization, timingOptions);
    const normalizedExpected = normalizeText(expectedText);
    const match = await findVisibleElement(
        page,
        selector,
        (details) => {
            const value = normalizeText(
                useAccessibleName ? details.accessibleName : details.text
            );
            const textMatches = matchPrefix
                ? value.startsWith(normalizedExpected)
                : value === normalizedExpected;

            return textMatches && (!requireEnabled || !details.disabled);
        }
    );

    if (!match) {
        throw new PersonalProfilePostDeletionError(
            `Елемент «${expectedText}» зник після React-стабілізації`,
            {
                code: "FACEBOOK_PERSONAL_DELETE_ELEMENT_DETACHED",
                status:
                    facebookPersonalProfilePostDeletionStatuses.ELEMENT_NOT_FOUND,
                stage: "INTERACTION",
                selector,
            }
        );
    }

    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.found",
        `Знайдено свіжий елемент «${expectedText}»`,
        { selector, expectedText }
    );

    try {
        await clickVerifiedElement(page, match.element, timingOptions);
    } finally {
        await match.element.dispose().catch(() => {});
    }

    return match.details;
}


async function clickFreshSelector(
    page,
    selector,
    timeout,
    timingOptions,
    stabilization = "medium"
) {
    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.search",
        "Шукаємо видимий елемент за селектором",
        { selector }
    );
    const initial = await waitForVisibleElement(page, selector, { timeout });
    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.visible",
        "Елемент став видимим; очікуємо стабілізацію React",
        { selector }
    );
    await initial.dispose().catch(() => {});
    await waitHuman(stabilization, timingOptions);
    const element = await waitForVisibleElement(page, selector, { timeout });
    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.found",
        "Повторно знайдено свіжий element handle",
        { selector }
    );

    try {
        await clickVerifiedElement(page, element, timingOptions);
    } finally {
        await element.dispose().catch(() => {});
    }
}


async function readManagePostsState(page) {
    return page.evaluate((dialogSelector) => {
        const dialog = document.querySelector(dialogSelector);

        if (!dialog) return { dialogVisible: false };

        const visible = (node) => {
            const rectangle = node.getBoundingClientRect();
            const style = getComputedStyle(node);

            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden";
        };
        const normalize = (value) => String(value ?? "")
            .replace(/\s+/g, " ")
            .trim();
        const buttons = Array.from(dialog.querySelectorAll('[role="button"]'));
        const checkboxes = Array.from(
            dialog.querySelectorAll('input[type="checkbox"]')
        );
        const classifyPost = (checkbox, index) => {
            let container = checkbox.parentElement;
            let permalink = null;

            while (container && container !== dialog) {
                permalink = container.querySelector(
                    'a[href*="story_fbid"], a[href*="/posts/"], '
                    + 'a[href*="/photo/"]'
                );
                if (permalink) break;
                container = container.parentElement;
            }

            const text = normalize([
                container?.innerText,
                ...Array.from(container?.querySelectorAll("a[aria-label]") ?? [])
                    .map((anchor) => anchor.getAttribute("aria-label")),
            ].join(" "));

            return {
                key: permalink?.href || `${text.slice(0, 300)}#${index}`,
                systemPost:
                    /updated\b[\s\S]*\b(profile picture|cover photo)\b/i
                        .test(text),
                selected: checkbox.getAttribute("aria-checked") === "true"
                    || checkbox.checked === true,
                visible: visible(checkbox),
            };
        };
        const posts = checkboxes.map(classifyPost);
        const counter = normalize(dialog.innerText).match(/(\d+)\s*\/\s*50\b/);
        const selectedInDom = checkboxes.filter((node) =>
            node.getAttribute("aria-checked") === "true"
            || node.checked === true
        ).length;
        const scrollContainers = [dialog, ...dialog.querySelectorAll("div")]
            .filter((node) => {
                const { overflowY } = getComputedStyle(node);
                return node.scrollHeight > node.clientHeight + 2
                    && (overflowY === "auto" || overflowY === "scroll");
            });
        const scrollContainer = scrollContainers.sort(
            (left, right) => right.scrollHeight - left.scrollHeight
        )[0] ?? dialog;

        return {
            dialogVisible: visible(dialog),
            selectedCount: Math.max(
                selectedInDom,
                counter ? Number(counter[1]) : 0
            ),
            visibleSelectAllCount: buttons.filter((node) =>
                visible(node)
                && normalize(node.innerText).toLocaleLowerCase() === "select all"
            ).length,
            visibleAddCheckboxCount: checkboxes.filter((node) =>
                visible(node)
                && String(node.getAttribute("aria-label") ?? "")
                    .toLocaleLowerCase() === "add"
            ).length,
            postCheckboxCount: checkboxes.length,
            posts,
            systemPostCount: posts.filter((post) => post.systemPost).length,
            ordinaryPostCount: posts.filter((post) => !post.systemPost).length,
            scrollTop: scrollContainer.scrollTop,
            clientHeight: scrollContainer.clientHeight,
            scrollHeight: scrollContainer.scrollHeight,
            atBottom: scrollContainer.scrollTop + scrollContainer.clientHeight
                >= scrollContainer.scrollHeight - 4,
        };
    }, personalProfileManagePostsDialogSelector);
}


async function waitForSelectionIncrease(page, previousCount, timeout) {
    await page.waitForFunction(
        (dialogSelector, oldCount) => {
            const dialog = document.querySelector(dialogSelector);
            if (!dialog) return false;

            const counter = String(dialog.innerText ?? "")
                .replace(/\s+/g, " ")
                .match(/(\d+)\s*\/\s*50\b/);
            const selectedInDom = Array.from(
                dialog.querySelectorAll('input[type="checkbox"]')
            ).filter((node) =>
                node.getAttribute("aria-checked") === "true"
                || node.checked === true
            ).length;

            return Math.max(
                selectedInDom,
                counter ? Number(counter[1]) : 0
            ) > oldCount;
        },
        { timeout },
        personalProfileManagePostsDialogSelector,
        previousCount
    );
}


async function scrollManagePostsDown(page, timingOptions) {
    const dialog = await waitForVisibleElement(
        page,
        personalProfileManagePostsDialogSelector,
        { timeout: 15000 }
    );

    try {
        await moveMouseToElement(page, dialog, {
            scrollIntoView: false,
            steps: [10, 20],
            inset: [0.35, 0.65],
            ...timingOptions,
        });
        await page.mouse.wheel({
            deltaY: randomInteger(550, 900, { random: timingOptions.random }),
        });
    } finally {
        await dialog.dispose().catch(() => {});
    }

    await waitHuman("long", timingOptions);
}


async function ensureManagePostsOpen(page, timeout, timingOptions) {
    const existingDialog = await getFirstVisibleElement(
        page,
        personalProfileManagePostsDialogSelector
    );

    if (existingDialog) {
        await existingDialog.dispose().catch(() => {});
        return;
    }

    await clickFreshSelector(
        page,
        personalProfileManagePostsButtonSelector,
        timeout,
        timingOptions,
        "long"
    );
    await waitForVisibleElement(
        page,
        personalProfileManagePostsDialogSelector,
        { timeout }
    ).then((element) => element.dispose());
    await waitHuman("long", timingOptions);
}


async function returnToPersonalProfile(page, timeout, timingOptions) {
    await openPageWithoutPopups(page, "https://www.facebook.com/me", {
        timeout,
    });
    await page.waitForFunction(
        () => document.readyState === "complete",
        { timeout }
    );
    await waitHuman("long", timingOptions);
}


async function ensureManagePostsOpenWithFallback(
    page,
    timeout,
    timingOptions
) {
    try {
        await ensureManagePostsOpen(
            page,
            Math.min(timeout, 15000),
            timingOptions
        );
    } catch {
        // Fallback потрібен лише якщо Facebook справді залишив сторінку профілю.
        await returnToPersonalProfile(page, timeout, timingOptions);
        await ensureManagePostsOpen(page, timeout, timingOptions);
    }
}


async function closeManagePosts(page, timeout, timingOptions) {
    const dialog = await getFirstVisibleElement(
        page,
        personalProfileManagePostsDialogSelector
    );

    if (dialog) {
        await dialog.dispose().catch(() => {});
        await clickFreshSelector(
            page,
            personalProfileManagePostsCloseButtonSelector,
            timeout,
            timingOptions,
            "short"
        );
        await page.waitForFunction(
            (selector) => !document.querySelector(selector),
            { timeout },
            personalProfileManagePostsDialogSelector
        );
        await waitHuman("medium", timingOptions);
        reportInteraction(
            timingOptions,
            "facebook.personal_posts.manager.closed",
            "Діалог Manage posts закрито",
            { selector: personalProfileManagePostsCloseButtonSelector }
        );
    }
}


async function reopenManagePosts(page, timeout, timingOptions) {
    await closeManagePosts(page, timeout, timingOptions);

    await ensureManagePostsOpenWithFallback(page, timeout, timingOptions);
}


async function scanAllPosts(page, timingOptions) {
    const discovered = new Map();
    let stableRounds = 0;
    let previousState = await readManagePostsState(page);

    if (previousState.postCheckboxCount === 0) {
        reportInteraction(
            timingOptions,
            "facebook.personal_posts.scan.empty",
            "Manage posts порожній, скрол для перевірки не потрібен",
            { totalCount: 0 }
        );
        return {
            totalCount: 0,
            systemCount: 0,
            ordinaryCount: 0,
            posts: [],
        };
    }

    while (stableRounds < stableScrollRoundsRequired) {
        const beforeSize = discovered.size;
        for (const post of previousState.posts ?? []) {
            discovered.set(post.key, post);
        }

        await scrollManagePostsDown(page, timingOptions);
        const nextState = await readManagePostsState(page);
        for (const post of nextState.posts ?? []) {
            discovered.set(post.key, post);
        }

        const scrollChanged = nextState.scrollTop !== previousState.scrollTop
            || nextState.scrollHeight !== previousState.scrollHeight;
        const foundNewPosts = discovered.size > beforeSize;

        stableRounds = foundNewPosts || (scrollChanged && !nextState.atBottom)
            ? 0
            : stableRounds + 1;
        previousState = nextState;
    }

    const posts = [...discovered.values()];
    return {
        totalCount: posts.length,
        systemCount: posts.filter((post) => post.systemPost).length,
        ordinaryCount: posts.filter((post) => !post.systemPost).length,
        posts,
    };
}


async function clickPostCheckbox(
    page,
    postKey,
    systemPost,
    timeout,
    timingOptions
) {
    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.search",
        systemPost
            ? "Шукаємо чекбокс системного поста"
            : "Шукаємо чекбокс звичайного поста",
        {
            selector: personalProfileManagePostsCheckboxSelector,
            postKey,
            postType: systemPost ? "system" : "ordinary",
        }
    );
    await page.waitForFunction(
        (selector, expectedKey, expectedSystem) => {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            return Array.from(document.querySelectorAll(selector)).some(
                (checkbox, index) => {
                    const rectangle = checkbox.getBoundingClientRect();
                    let container = checkbox.parentElement;
                    let permalink = null;

                    while (container && container.getAttribute("role") !== "dialog") {
                        permalink = container.querySelector(
                            'a[href*="story_fbid"], a[href*="/posts/"], '
                            + 'a[href*="/photo/"]'
                        );
                        if (permalink) break;
                        container = container.parentElement;
                    }
                    const text = normalize([
                        container?.innerText,
                        ...Array.from(
                            container?.querySelectorAll("a[aria-label]") ?? []
                        ).map((anchor) => anchor.getAttribute("aria-label")),
                    ].join(" "));
                    const key = permalink?.href
                        || `${text.slice(0, 300)}#${index}`;
                    const isSystem =
                        /updated\b[\s\S]*\b(profile picture|cover photo)\b/i
                            .test(text);

                    return rectangle.width > 0
                        && rectangle.height > 0
                        && key === expectedKey
                        && isSystem === expectedSystem;
                }
            );
        },
        { timeout },
        personalProfileManagePostsCheckboxSelector,
        postKey,
        systemPost
    );
    await waitRandom(250, 550, timingOptions);
    const fresh = await findVisibleElement(
        page,
        personalProfileManagePostsCheckboxSelector,
        (details) => details.postKey === postKey
            && details.systemPost === systemPost
    );

    if (!fresh) {
        throw new Error(`Чекбокс допису зник після стабілізації: ${postKey}`);
    }

    reportInteraction(
        timingOptions,
        "facebook.personal_posts.selector.found",
        "Знайдено свіжий чекбокс потрібного поста",
        {
            selector: personalProfileManagePostsCheckboxSelector,
            postKey,
            postType: systemPost ? "system" : "ordinary",
        }
    );

    try {
        await clickVerifiedElement(page, fresh.element, timingOptions, {
            beforeDelay: [40, 90],
            holdDelay: [70, 130],
            scrollDelay: [180, 350],
        });
    } finally {
        await fresh.element.dispose().catch(() => {});
    }
}


async function selectPostsByKind(
    page,
    systemPost,
    timeout,
    timingOptions,
    onProgress
) {
    const selectedKeys = new Set();
    const discovered = new Map();
    let stableRounds = 0;
    let previousState = await readManagePostsState(page);

    if (previousState.postCheckboxCount === 0) {
        reportInteraction(
            timingOptions,
            "facebook.personal_posts.scan.empty",
            "Manage posts порожній, вибір і скрол не потрібні",
            { postType: systemPost ? "system" : "ordinary" }
        );
        return {
            selectedCount: 0,
            selectedKeys: [],
            discoveredSystemCount: 0,
            discoveredOrdinaryCount: 0,
            reachedLimit: false,
        };
    }

    while (
        stableRounds < stableScrollRoundsRequired
        && previousState.selectedCount < selectionLimit
    ) {
        for (const post of previousState.posts ?? []) {
            discovered.set(post.key, post);
        }
        const checkbox = await findVisibleElement(
            page,
            personalProfileManagePostsCheckboxSelector,
            (details) => details.systemPost === systemPost
                && !selectedKeys.has(details.postKey)
        );

        if (checkbox) {
            const beforeCount = previousState.selectedCount;
            const postKey = checkbox.details.postKey;
            await checkbox.element.dispose().catch(() => {});
            await clickPostCheckbox(
                page,
                postKey,
                systemPost,
                timeout,
                timingOptions
            );
            await waitForSelectionIncrease(page, beforeCount, timeout);
            await waitRandom(250, 600, timingOptions);
            selectedKeys.add(postKey);
            previousState = await readManagePostsState(page);
            stableRounds = 0;
            reportInteraction(
                timingOptions,
                "facebook.personal_posts.selection.confirmed",
                systemPost
                    ? "Вибір системного поста підтверджено"
                    : "Вибір звичайного поста підтверджено",
                {
                    postKey,
                    postType: systemPost ? "system" : "ordinary",
                    selectedCount: previousState.selectedCount,
                }
            );
            await emitProgress(onProgress, {
                type: systemPost
                    ? "system_post_selected"
                    : "ordinary_post_selected",
                postKey,
                selectedCount: previousState.selectedCount,
            });
            continue;
        }

        await scrollManagePostsDown(page, timingOptions);
        const nextState = await readManagePostsState(page);
        for (const post of nextState.posts ?? []) {
            discovered.set(post.key, post);
        }
        const scrollChanged = nextState.scrollTop !== previousState.scrollTop
            || nextState.scrollHeight !== previousState.scrollHeight;

        stableRounds = scrollChanged && !nextState.atBottom
            ? 0
            : stableRounds + 1;
        previousState = nextState;
    }

    return {
        selectedCount: previousState.selectedCount,
        selectedKeys: [...selectedKeys],
        discoveredSystemCount: [...discovered.values()]
            .filter((post) => post.systemPost).length,
        discoveredOrdinaryCount: [...discovered.values()]
            .filter((post) => !post.systemPost).length,
        reachedLimit: previousState.selectedCount >= selectionLimit,
    };
}


async function selectAllAvailablePosts(
    page,
    timeout,
    timingOptions,
    onProgress
) {
    const processedSections = new Set();
    let fallbackClicks = 0;
    let stableRounds = 0;
    let previousState = await readManagePostsState(page);

    while (
        stableRounds < stableScrollRoundsRequired
        && previousState.selectedCount < selectionLimit
    ) {
        const selectAll = await findVisibleElement(
            page,
            personalProfileManagePostsButtonCandidatesSelector,
            (details) => normalizeText(details.text) === "select all"
        );

        if (selectAll) {
            const beforeCount = previousState.selectedCount;
            const sectionKey = selectAll.details.sectionKey;

            await selectAll.element.dispose().catch(() => {});
            await clickFreshMatch(
                page,
                personalProfileManagePostsButtonCandidatesSelector,
                "Select all",
                timeout,
                timingOptions
            );

            try {
                await waitForSelectionIncrease(page, beforeCount, timeout);
            } catch {
                const fallback = await findVisibleElement(
                    page,
                    personalProfileManagePostsCheckboxSelector,
                    () => true
                );

                if (fallback) {
                    try {
                        await clickVerifiedElement(
                            page,
                            fallback.element,
                            timingOptions
                        );
                        fallbackClicks += 1;
                        await waitForSelectionIncrease(
                            page,
                            beforeCount,
                            timeout
                        );
                    } finally {
                        await fallback.element.dispose().catch(() => {});
                    }
                }
            }

            await waitHuman("medium", timingOptions);
            const nextState = await readManagePostsState(page);

            if (nextState.selectedCount > beforeCount) {
                processedSections.add(sectionKey);
                stableRounds = 0;
                await emitProgress(onProgress, {
                    type: "section_selected",
                    section: sectionKey,
                    selectedCount: nextState.selectedCount,
                });
            } else {
                stableRounds += 1;
            }

            previousState = nextState;
            continue;
        }

        if (previousState.visibleAddCheckboxCount > 0) {
            const beforeCount = previousState.selectedCount;
            const fallback = await findVisibleElement(
                page,
                personalProfileManagePostsCheckboxSelector,
                () => true
            );

            if (fallback) {
                try {
                    await clickVerifiedElement(
                        page,
                        fallback.element,
                        timingOptions
                    );
                    fallbackClicks += 1;
                    await waitForSelectionIncrease(page, beforeCount, timeout);
                    await waitHuman("medium", timingOptions);
                } finally {
                    await fallback.element.dispose().catch(() => {});
                }
                previousState = await readManagePostsState(page);
                stableRounds = 0;
                continue;
            }
        }

        await scrollManagePostsDown(page, timingOptions);
        const nextState = await readManagePostsState(page);
        const scrollChanged = nextState.scrollTop !== previousState.scrollTop
            || nextState.scrollHeight !== previousState.scrollHeight;

        stableRounds = scrollChanged && !nextState.atBottom
            ? 0
            : stableRounds + 1;
        previousState = nextState;
    }

    return {
        selectedCount: previousState.selectedCount,
        processedSections: [...processedSections],
        fallbackClicks,
        reachedLimit: previousState.selectedCount >= selectionLimit,
    };
}


async function chooseManageAction(
    page,
    actionName,
    timeout,
    timingOptions
) {
    await clickFreshSelector(
        page,
        personalProfileManagePostsNextButtonSelector,
        timeout,
        timingOptions,
        "medium"
    );
    await clickFreshMatch(
        page,
        personalProfileManagePostsActionRadioSelector,
        actionName,
        timeout,
        timingOptions,
        {
            useAccessibleName: true,
            requireEnabled: true,
            matchPrefix: true,
            stabilization: "long",
        }
    );
    await page.waitForFunction(
        (selector, expectedAction) => Array.from(
            document.querySelectorAll(selector)
        )
            .some((node) => {
                const labelledBy = node.getAttribute("aria-labelledby");
                const label = String(labelledBy ?? "")
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((id) => document.getElementById(id)?.innerText ?? "")
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase();

                return label.startsWith(expectedAction.toLocaleLowerCase())
                    && node.getAttribute("aria-checked") === "true";
            }),
        { timeout },
        personalProfileManagePostsActionRadioSelector,
        actionName
    );
    await page.waitForFunction(
        (selector) => {
            const button = document.querySelector(selector);
            return button && button.getAttribute("aria-disabled") !== "true";
        },
        { timeout },
        personalProfileManagePostsDoneButtonSelector
    );
    await waitHuman("medium", timingOptions);
}


async function completeManageAction(
    page,
    confirmationNames,
    timeout,
    timingOptions
) {
    await clickFreshSelector(
        page,
        personalProfileManagePostsDoneButtonSelector,
        timeout,
        timingOptions,
        "medium"
    );
    await waitHuman("long", timingOptions);

    let confirmation = null;

    try {
        confirmation = await findVisibleElement(
            page,
            personalProfileDeleteConfirmationButtonCandidatesSelector,
            (details) => {
                const name = normalizeText(
                    details.accessibleName || details.text
                );
                return confirmationNames.includes(name)
                    && !details.disabled;
            }
        );
    } catch {
        // Після Hide posts Facebook може саме в цей момент перейти на головну.
        await waitHuman("long", timingOptions);
    }

    if (confirmation) {
        const confirmationName = confirmation.details.accessibleName
            || confirmation.details.text;
        await confirmation.element.dispose().catch(() => {});
        await clickFreshMatch(
            page,
            personalProfileDeleteConfirmationButtonCandidatesSelector,
            confirmationName,
            timeout,
            timingOptions,
            {
                useAccessibleName: true,
                requireEnabled: true,
                stabilization: "medium",
            }
        );
    }

    try {
        await page.waitForFunction(
            (dialogSelector, radioSelector) => {
                const dialog = document.querySelector(dialogSelector);
                return !dialog
                    || !dialog.querySelector(radioSelector.split(" ").at(-1));
            },
            { timeout },
            personalProfileManagePostsDialogSelector,
            personalProfileManagePostsActionRadioSelector
        );
    } catch (error) {
        const dialog = await getFirstVisibleElement(
            page,
            personalProfileManagePostsDialogSelector
        ).catch(() => null);

        if (dialog) {
            await dialog.dispose().catch(() => {});
            throw error;
        }
    }
    await waitHuman("long", timingOptions);
}


function statusFromVerification(verification, hadInitialPosts) {
    if (verification.totalCount === 0) {
        return hadInitialPosts
            ? facebookPersonalProfilePostDeletionStatuses.CLEANED
            : facebookPersonalProfilePostDeletionStatuses.NO_POSTS;
    }
    if (
        verification.systemCount > 0
        && verification.ordinaryCount > 0
    ) {
        return facebookPersonalProfilePostDeletionStatuses.MIXED_POSTS_REMAIN;
    }
    if (verification.systemCount > 0) {
        return facebookPersonalProfilePostDeletionStatuses.SYSTEM_POSTS_REMAIN;
    }
    return facebookPersonalProfilePostDeletionStatuses.ORDINARY_POSTS_REMAIN;
}


export default async function deleteAllFacebookPersonalProfilePosts(
    page,
    {
        timeout = 90000,
        random = Math.random,
        sleep,
        onProgress = null,
        logger = console,
    } = {}
) {
    const startedAt = new Date().toISOString();
    let stage = "VALIDATE_INPUT";
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
    const timingOptions = {
        random,
        ...(sleep ? { sleep } : {}),
        report,
    };
    let systemSelection = null;
    let ordinarySelection = null;
    let hiddenSystemCount = 0;
    let deletedOrdinaryCount = 0;
    let hideVerification = null;
    let managerClosed = false;

    const finish = (status, extra = {}) => {
        const result = {
            success: status === facebookPersonalProfilePostDeletionStatuses.CLEANED
            || status === facebookPersonalProfilePostDeletionStatuses.NO_POSTS,
            status,
            stage: extra.stage ?? stage,
            systemSelectedCount: systemSelection?.selectedCount ?? 0,
            systemHideSubmittedCount: systemSelection?.selectedCount ?? 0,
            hiddenSystemCount,
            systemHideVerified: hideVerification?.systemCount === 0,
            ordinarySelectedCount: ordinarySelection?.selectedCount ?? 0,
            ordinaryDeleteSubmittedCount: ordinarySelection?.selectedCount ?? 0,
            deletedOrdinaryCount,
            processedSections: ordinarySelection?.processedSections ?? [],
            fallbackClicks: ordinarySelection?.fallbackClicks ?? 0,
            reachedLimit: Boolean(
                systemSelection?.reachedLimit || ordinarySelection?.reachedLimit
            ),
            hideVerification,
            verification: extra.verification ?? null,
            managerClosed,
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: typeof page?.url === "function" ? page.url() : null,
            error: extra.error ?? null,
        };

        report(
            result.success
                ? "facebook.personal_posts.completed"
                : "facebook.personal_posts.failed",
            result.success
                ? "Очищення постів особистого профілю завершено"
                : "Очищення постів особистого профілю завершилося з помилкою",
            {
                status: result.status,
                resultStage: result.stage,
                managerClosed,
                remainingSystemCount: result.verification?.systemCount ?? null,
                remainingOrdinaryCount: result.verification?.ordinaryCount ?? null,
                error: result.error,
            },
            result.success ? "info" : "error"
        );
        return result;
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

        report(
            "facebook.personal_posts.started",
            "Починаємо очищення постів особистого профілю"
        );
        stage = "OPEN_MANAGE_POSTS_FOR_SYSTEM_POSTS";
        report("facebook.personal_posts.stage", "Відкриваємо Manage posts");
        await ensureManagePostsOpenWithFallback(page, timeout, timingOptions);
        await emitProgress(onProgress, { type: "manage_posts_opened" });

        stage = "SELECT_SYSTEM_POSTS";
        systemSelection = await selectPostsByKind(
            page,
            true,
            timeout,
            timingOptions,
            onProgress
        );
        const hadInitialPosts = systemSelection.discoveredSystemCount > 0
            || systemSelection.discoveredOrdinaryCount > 0;
        report(
            "facebook.personal_posts.initial_scan.completed",
            "Початкове сканування Manage posts завершено",
            {
                systemCount: systemSelection.discoveredSystemCount,
                ordinaryCount: systemSelection.discoveredOrdinaryCount,
            }
        );

        if (!hadInitialPosts) {
            hideVerification = {
                totalCount: 0,
                systemCount: 0,
                ordinaryCount: 0,
                posts: [],
            };
            await emitProgress(onProgress, {
                type: "system_posts_absent",
                ordinaryCount: 0,
            });
            await emitProgress(onProgress, {
                type: "final_verification",
                hiddenSystemCount: 0,
                deletedOrdinaryCount: 0,
                remainingSystemCount: 0,
                remainingOrdinaryCount: 0,
            });
            stage = "CLOSE_FINAL_MANAGE_POSTS";
            await closeManagePosts(page, timeout, timingOptions);
            managerClosed = true;
            await emitProgress(onProgress, {
                type: "final_manage_posts_closed",
                remainingSystemCount: 0,
                remainingOrdinaryCount: 0,
            });
            return finish(
                facebookPersonalProfilePostDeletionStatuses.NO_POSTS,
                {
                    stage: "COMPLETED",
                    verification: hideVerification,
                }
            );
        }

        if (systemSelection.selectedCount > 0) {
            stage = "CHOOSE_HIDE_SYSTEM_POSTS";
            await chooseManageAction(
                page,
                "Hide posts",
                timeout,
                timingOptions
            );
            stage = "CONFIRM_HIDE_SYSTEM_POSTS";
            await completeManageAction(
                page,
                ["hide", "hide posts"],
                timeout,
                timingOptions
            );
            stage = "VERIFY_SYSTEM_POSTS_HIDDEN";
            await emitProgress(onProgress, {
                type: "reopen_manage_posts_after_hide",
                currentUrl: page.url(),
            });
            await ensureManagePostsOpenWithFallback(
                page,
                timeout,
                timingOptions
            );
            await emitProgress(onProgress, {
                type: "manage_posts_reopened_after_hide",
                currentUrl: page.url(),
            });
            hideVerification = await scanAllPosts(page, timingOptions);
            hiddenSystemCount = Math.max(
                0,
                systemSelection.discoveredSystemCount
                    - hideVerification.systemCount
            );
            await emitProgress(onProgress, {
                type: "system_hide_verified",
                hiddenSystemCount,
                remainingSystemCount: hideVerification.systemCount,
            });
        } else {
            hideVerification = {
                totalCount: systemSelection.discoveredOrdinaryCount,
                systemCount: 0,
                ordinaryCount: systemSelection.discoveredOrdinaryCount,
                posts: [],
            };
            report(
                "facebook.personal_posts.system_posts.absent",
                "Системних постів не знайдено, одразу переходимо до звичайних",
                { ordinaryCount: hideVerification.ordinaryCount }
            );
            await emitProgress(onProgress, {
                type: "system_posts_absent",
                ordinaryCount: hideVerification.ordinaryCount,
            });
        }

        if (hideVerification.ordinaryCount > 0) {
            stage = "OPEN_MANAGE_POSTS_FOR_ORDINARY_POSTS";
            await reopenManagePosts(page, timeout, timingOptions);

            stage = "SELECT_ORDINARY_POSTS";
            ordinarySelection = hideVerification.systemCount === 0
                ? await selectAllAvailablePosts(
                    page,
                    timeout,
                    timingOptions,
                    onProgress
                )
                : await selectPostsByKind(
                    page,
                    false,
                    timeout,
                    timingOptions,
                    onProgress
                );

            if (ordinarySelection.selectedCount > 0) {
                stage = "CHOOSE_DELETE_ORDINARY_POSTS";
                await chooseManageAction(
                    page,
                    "Delete posts",
                    timeout,
                    timingOptions
                );
                stage = "CONFIRM_DELETE_ORDINARY_POSTS";
                await completeManageAction(
                    page,
                    ["delete", "delete posts"],
                    timeout,
                    timingOptions
                );
                await emitProgress(onProgress, {
                    type: "ordinary_delete_submitted",
                    submittedCount: ordinarySelection.selectedCount,
                });
            }
        }

        stage = "VERIFY_RESULT";
        await reopenManagePosts(page, timeout, timingOptions);
        const verification = await scanAllPosts(page, timingOptions);
        report(
            "facebook.personal_posts.final_scan.completed",
            "Фінальне сканування Manage posts завершено",
            {
                systemCount: verification.systemCount,
                ordinaryCount: verification.ordinaryCount,
                totalCount: verification.totalCount,
            }
        );
        const finalStatus = statusFromVerification(
            verification,
            hadInitialPosts
        );
        deletedOrdinaryCount = Math.max(
            0,
            hideVerification.ordinaryCount - verification.ordinaryCount
        );
        await emitProgress(onProgress, {
            type: "final_verification",
            hiddenSystemCount,
            deletedOrdinaryCount,
            remainingSystemCount: verification.systemCount,
            remainingOrdinaryCount: verification.ordinaryCount,
        });

        stage = "CLOSE_FINAL_MANAGE_POSTS";
        await closeManagePosts(page, timeout, timingOptions);
        managerClosed = true;
        await emitProgress(onProgress, {
            type: "final_manage_posts_closed",
            remainingSystemCount: verification.systemCount,
            remainingOrdinaryCount: verification.ordinaryCount,
        });

        return finish(finalStatus, {
            stage: "COMPLETED",
            verification,
        });
    } catch (error) {
        const normalized = error instanceof PersonalProfilePostDeletionError
            ? error
            : new PersonalProfilePostDeletionError(
                error?.message ?? String(error),
                {
                    code: `FACEBOOK_PERSONAL_DELETE_${stage}_FAILED`,
                    status: stage.includes("HIDE")
                        ? facebookPersonalProfilePostDeletionStatuses.HIDE_FAILED
                        : stage.includes("DELETE")
                            ? facebookPersonalProfilePostDeletionStatuses
                                .DELETE_FAILED
                        : stage === "VERIFY_RESULT"
                            || stage === "CLOSE_FINAL_MANAGE_POSTS"
                            ? facebookPersonalProfilePostDeletionStatuses
                                .VERIFICATION_FAILED
                            : facebookPersonalProfilePostDeletionStatuses
                                .ELEMENT_NOT_FOUND,
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
