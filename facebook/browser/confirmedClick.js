import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "./elements.js";
import { humanClickElement } from "./pointer.js";


export class ConfirmedClickError extends Error {
    constructor(message, {
        code = "BROWSER_CLICK_NOT_CONFIRMED",
        selector = null,
        timeoutMs = null,
        attempt = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "ConfirmedClickError";
        this.code = code;
        this.selector = selector;
        this.timeoutMs = timeoutMs;
        this.attempt = attempt;
    }
}


export function normalizeLocatorText(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}


export function matchesLocatorText(actual, expected) {
    return normalizeLocatorText(actual) === normalizeLocatorText(expected);
}


export function describeLocator(locator) {
    const normalized = normalizeLocator(locator);

    if (normalized.type === "selector") {
        return normalized.index === null
            ? normalized.selector
            : `${normalized.selector}[${normalized.index}]`;
    }

    const closest = normalized.closestSelector
        ? ` -> closest(${normalized.closestSelector})`
        : "";

    return `${normalized.candidateSelector} text="${normalized.expectedText}"${closest}`;
}


function normalizeLocator(locator) {
    if (!locator || typeof locator !== "object") {
        throw new TypeError("Локатор елемента має бути об’єктом");
    }

    if (typeof locator.selector === "string" && locator.selector.trim() !== "") {
        const index = locator.index ?? null;

        if (index !== null && (!Number.isInteger(index) || index < 0)) {
            throw new RangeError(
                `Індекс елемента має бути невід’ємним цілим числом: ${index}`
            );
        }

        return {
            type: "selector",
            selector: locator.selector,
            index,
        };
    }

    if (
        typeof locator.candidateSelector === "string"
        && locator.candidateSelector.trim() !== ""
        && locator.expectedText != null
        && String(locator.expectedText).trim() !== ""
    ) {
        return {
            type: "text",
            candidateSelector: locator.candidateSelector,
            expectedText: String(locator.expectedText),
            closestSelector: locator.closestSelector ?? null,
        };
    }

    throw new TypeError("Локатор має містити selector або текст кнопки");
}


function validateQuietOptions(quietMs, timeout) {
    if (!Number.isInteger(quietMs) || quietMs < 1) {
        throw new RangeError(`Некоректна тиша DOM: ${quietMs}`);
    }

    if (!Number.isInteger(timeout) || timeout < quietMs) {
        throw new RangeError(
            `Некоректний ліміт стабілізації DOM: ${timeout}`
        );
    }
}


export function waitForDomQuietInPage(locator, quietMs, timeout) {
    const normalize = (value) => String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const isVisible = (element) => {
        if (!element || !element.isConnected) {
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
    const findElement = () => {
        if (locator.type === "selector") {
            const elements = Array.from(
                document.querySelectorAll(locator.selector)
            );
            const candidates = locator.index === null
                ? elements
                : [elements[locator.index]].filter(Boolean);

            return candidates.find(isVisible) ?? null;
        }

        const expected = normalize(locator.expectedText);

        for (const candidate of document.querySelectorAll(
            locator.candidateSelector
        )) {
            if (normalize(candidate.textContent) !== expected) {
                continue;
            }

            const element = locator.closestSelector
                ? candidate.closest(locator.closestSelector)
                : candidate;

            if (isVisible(element)) {
                return element;
            }
        }

        return null;
    };
    const fingerprint = (element) => {
        if (!isVisible(element)) {
            return null;
        }

        const rectangle = element.getBoundingClientRect();

        return [
            element.tagName,
            element.getAttribute("aria-label") ?? "",
            element.getAttribute("aria-disabled") ?? "",
            normalize(element.textContent),
            element.childElementCount,
            Math.round(rectangle.width),
            Math.round(rectangle.height),
        ].join("|");
    };

    return new Promise((resolve) => {
        const startedAt = Date.now();
        let lastFingerprint = null;
        let quietSince = null;

        const tick = () => {
            const currentFingerprint = fingerprint(findElement());
            const now = Date.now();

            if (currentFingerprint !== lastFingerprint) {
                lastFingerprint = currentFingerprint;
                quietSince = currentFingerprint === null ? null : now;
            }

            if (
                currentFingerprint !== null
                && quietSince !== null
                && now - quietSince >= quietMs
            ) {
                resolve(true);
                return;
            }

            if (now - startedAt >= timeout) {
                resolve(false);
                return;
            }

            setTimeout(tick, 50);
        };

        tick();
    });
}


export function isLocatorVisibleInPage(locator) {
    const normalize = (value) => String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const isVisible = (element) => {
        if (!element || !element.isConnected) {
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

    if (locator.type === "selector") {
        const elements = Array.from(
            document.querySelectorAll(locator.selector)
        );
        const candidates = locator.index === null
            ? elements
            : [elements[locator.index]].filter(Boolean);

        return candidates.some(isVisible);
    }

    const expected = normalize(locator.expectedText);

    return Array.from(
        document.querySelectorAll(locator.candidateSelector)
    ).some((candidate) => {
        if (normalize(candidate.textContent) !== expected) {
            return false;
        }

        const element = locator.closestSelector
            ? candidate.closest(locator.closestSelector)
            : candidate;

        return isVisible(element);
    });
}


export function findLocatorInPage(locator) {
    const normalize = (value) => String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
    const isVisible = (element) => {
        if (!element || !element.isConnected) {
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

    if (locator.type === "selector") {
        const elements = Array.from(
            document.querySelectorAll(locator.selector)
        );
        const candidates = locator.index === null
            ? elements
            : [elements[locator.index]].filter(Boolean);

        return candidates.find(isVisible) ?? null;
    }

    const expected = normalize(locator.expectedText);

    for (const candidate of document.querySelectorAll(
        locator.candidateSelector
    )) {
        if (normalize(candidate.textContent) !== expected) {
            continue;
        }

        const element = locator.closestSelector
            ? candidate.closest(locator.closestSelector)
            : candidate;

        if (isVisible(element)) {
            return element;
        }
    }

    return null;
}


async function emitStep(onStep, message, details = {}) {
    if (typeof onStep !== "function") {
        return;
    }

    try {
        await onStep(message, details);
    } catch {
        // Помилка журналювання не повинна зупиняти клік
    }
}


async function disposeHandle(handle) {
    if (!handle || typeof handle.dispose !== "function") {
        return;
    }

    await handle.dispose().catch(() => {});
}


export async function waitForDomQuiet(
    page,
    locator,
    { quietMs = 300, timeout = 5000 } = {}
) {
    const normalized = normalizeLocator(locator);
    validateQuietOptions(quietMs, timeout);

    try {
        return Boolean(
            await page.evaluate(
                waitForDomQuietInPage,
                normalized,
                quietMs,
                timeout
            )
        );
    } catch {
        return false;
    }
}


async function getVisibleLocator(page, locator) {
    const normalized = normalizeLocator(locator);

    if (normalized.type === "selector") {
        return getFirstVisibleElement(page, normalized.selector, {
            index: normalized.index,
        });
    }

    const handle = await page.evaluateHandle(findLocatorInPage, normalized);
    const element = handle.asElement();

    if (!element) {
        await disposeHandle(handle);
        return null;
    }

    return element;
}


async function waitForVisibleLocator(page, locator, { timeout = 30000 } = {}) {
    const normalized = normalizeLocator(locator);

    if (normalized.type === "selector") {
        return waitForVisibleElement(page, normalized.selector, {
            timeout,
            index: normalized.index,
        });
    }

    let readyHandle;

    try {
        readyHandle = await page.waitForFunction(
            isLocatorVisibleInPage,
            { timeout },
            normalized
        );
    } catch (error) {
        throw new ConfirmedClickError(
            `Не знайдено видимий елемент: ${describeLocator(normalized)}`,
            {
                code: "BROWSER_ELEMENT_TIMEOUT",
                selector: describeLocator(normalized),
                timeoutMs: timeout,
                cause: error,
            }
        );
    } finally {
        await disposeHandle(readyHandle);
    }

    const element = await getVisibleLocator(page, normalized);

    if (!element) {
        throw new ConfirmedClickError(
            `Елемент зник після очікування: ${describeLocator(normalized)}`,
            {
                code: "BROWSER_ELEMENT_DISAPPEARED",
                selector: describeLocator(normalized),
                timeoutMs: timeout,
            }
        );
    }

    return element;
}


function defaultClickOptions() {
    return {
        scrollDelay: [900, 1600],
        fallbackScrollDelay: [250, 500],
        beforeDelay: [100, 260],
        holdDelay: [80, 170],
        steps: [9, 19],
    };
}


async function clickLocator(page, locator, {
    timeout,
    quietMs,
    quietTimeout,
    description,
    clickOptions,
    onStep,
}) {
    const selector = describeLocator(locator);

    await emitStep(onStep, `Чекаємо видимий елемент «${description}»`, {
        selector,
        timeout,
    });

    const initial = await waitForVisibleLocator(page, locator, { timeout });
    await disposeHandle(initial);

    await emitStep(
        onStep,
        `Чекаємо стабілізацію DOM для «${description}»`,
        {
            selector,
            quietMs,
            quietTimeout,
        }
    );
    const quiet = await waitForDomQuiet(page, locator, {
        quietMs,
        timeout: quietTimeout,
    });
    await emitStep(
        onStep,
        quiet
            ? `DOM «${description}» стабільний`
            : `DOM «${description}» не затих за ${quietTimeout} мс, клікаємо далі`,
        { selector, quiet }
    );

    await emitStep(onStep, `Шукаємо свіжий елемент «${description}»`, {
        selector,
    });
    const element = await waitForVisibleLocator(page, locator, { timeout });

    try {
        await humanClickElement(page, element, {
            ...defaultClickOptions(),
            ...clickOptions,
        });
        await emitStep(onStep, `Клікнули ЛКМ по «${description}»`, {
            selector,
        });
    } catch (error) {
        throw new ConfirmedClickError(
            `Не вдалося клікнути «${description}»: ${error.message}`,
            {
                code: "BROWSER_ELEMENT_INTERACTION_FAILED",
                selector,
                cause: error,
            }
        );
    } finally {
        await disposeHandle(element);
    }
}


export async function clickWhenStable(page, {
    target,
    description = "елемент",
    timeout = 30000,
    quietMs = 300,
    quietTimeout = 5000,
    clickOptions = {},
    onStep = null,
} = {}) {
    const normalizedTarget = normalizeLocator(target);

    await clickLocator(page, normalizedTarget, {
        timeout,
        quietMs,
        quietTimeout,
        description,
        clickOptions,
        onStep,
    });
}


export async function clickUntilConfirmed(page, {
    target,
    confirm,
    description = "елемент",
    attempts = 3,
    timeout = 30000,
    confirmTimeout = 15000,
    quietMs = 300,
    quietTimeout = 5000,
    clickOptions = {},
    onStep = null,
} = {}) {
    const normalizedTarget = normalizeLocator(target);
    const normalizedConfirm = normalizeLocator(confirm);
    const targetSelector = describeLocator(normalizedTarget);
    const confirmSelector = describeLocator(normalizedConfirm);

    if (!Number.isInteger(attempts) || attempts < 1) {
        throw new RangeError(`Некоректна кількість спроб кліку: ${attempts}`);
    }

    if (!Number.isInteger(confirmTimeout) || confirmTimeout < 1) {
        throw new RangeError(
            `Некоректний таймаут підтвердження: ${confirmTimeout}`
        );
    }

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        await emitStep(
            onStep,
            `Спроба ${attempt}/${attempts} кліку «${description}»`,
            {
                attempt,
                attempts,
                selector: targetSelector,
                confirmSelector,
            }
        );

        const alreadyConfirmed = await getVisibleLocator(
            page,
            normalizedConfirm
        );

        if (alreadyConfirmed) {
            await disposeHandle(alreadyConfirmed);
            await emitStep(
                onStep,
                `«${description}» уже підтверджено, клік не потрібен`,
                {
                    attempt,
                    selector: confirmSelector,
                }
            );
            return { attempt, clicked: false };
        }

        try {
            await clickLocator(page, normalizedTarget, {
                timeout,
                quietMs,
                quietTimeout,
                description,
                clickOptions,
                onStep,
            });
        } catch (error) {
            if (attempt === attempts) {
                throw error;
            }

            await emitStep(
                onStep,
                `Клік «${description}» не вдався, повторимо`,
                {
                    attempt,
                    selector: targetSelector,
                    message: error.message,
                }
            );
            continue;
        }

        await emitStep(
            onStep,
            `Чекаємо підтвердження після «${description}»`,
            {
                selector: confirmSelector,
                timeout: confirmTimeout,
                attempt,
            }
        );

        try {
            const confirmed = await waitForVisibleLocator(
                page,
                normalizedConfirm,
                { timeout: confirmTimeout }
            );
            await disposeHandle(confirmed);
            await emitStep(
                onStep,
                `Підтвердження після «${description}» з’явилось`,
                {
                    selector: confirmSelector,
                    attempt,
                }
            );
            return { attempt, clicked: true };
        } catch (error) {
            await emitStep(
                onStep,
                `Підтвердження після «${description}» не з’явилось`,
                {
                    selector: confirmSelector,
                    attempt,
                    timeout: confirmTimeout,
                    message: error.message,
                }
            );

            if (attempt === attempts) {
                throw new ConfirmedClickError(
                    `Не відкрилось після ${attempts} кліків «${description}»`,
                    {
                        code: "BROWSER_CLICK_NOT_CONFIRMED",
                        selector: targetSelector,
                        timeoutMs: confirmTimeout,
                        attempt,
                        cause: error,
                    }
                );
            }
        }
    }

    throw new ConfirmedClickError(
        `Не відкрилось після ${attempts} кліків «${description}»`,
        {
            code: "BROWSER_CLICK_NOT_CONFIRMED",
            selector: targetSelector,
            timeoutMs: confirmTimeout,
            attempt: attempts,
        }
    );
}
