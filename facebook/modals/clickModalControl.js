import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";


function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}


async function clickHandle(page, element, timingOptions) {
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


export async function clickModalSelector(
    page,
    selector,
    timeout,
    timingOptions,
    stabilization = "medium"
) {
    const initial = await waitForVisibleElement(page, selector, { timeout });
    await initial.dispose().catch(() => {});
    await waitHuman(stabilization, timingOptions);
    const fresh = await waitForVisibleElement(page, selector, { timeout });
    await clickHandle(page, fresh, timingOptions);
}


export async function clickModalButtonByText(
    page,
    selector,
    expectedText,
    timeout,
    timingOptions,
    { match = "exact" } = {}
) {
    const expected = normalizeText(expectedText);
    await page.waitForFunction(
        (targetSelector, targetText, matchMode) => Array.from(
            document.querySelectorAll(targetSelector)
        ).some((element) => {
            const rectangle = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            const text = String(element.textContent ?? "")
                .replace(/\s+/g, " ")
                .trim()
                .toLocaleLowerCase();
            const matched = matchMode === "startsWith"
                ? text.startsWith(targetText)
                : text === targetText;
            return matched
                && rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        }),
        { timeout },
        selector,
        expected,
        match
    );
    await waitHuman("medium", timingOptions);
    const handle = await page.evaluateHandle((targetSelector, targetText, matchMode) => {
        return Array.from(document.querySelectorAll(targetSelector)).find(
            (element) => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);
                const text = String(element.textContent ?? "")
                    .replace(/\s+/g, " ")
                    .trim()
                    .toLocaleLowerCase();
                const matched = matchMode === "startsWith"
                    ? text.startsWith(targetText)
                    : text === targetText;
                return matched
                    && rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            }
        ) ?? null;
    }, selector, expected, match);
    const element = handle.asElement();
    if (!element) {
        await handle.dispose().catch(() => {});
        throw new Error(`Не знайдено кнопку «${expectedText}»`);
    }
    await clickHandle(page, element, timingOptions);
}


export async function clickDialogSpanParent(
    page,
    {
        dialogSelector,
        spanSelector,
        expectedText,
        timeout,
        timingOptions,
    }
) {
    const expected = normalizeText(expectedText);
    await page.waitForFunction(
        (dlgSelector, labelSelector, targetText) => {
            const visible = (node) => {
                if (!node) return false;
                const rectangle = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            return Array.from(document.querySelectorAll(dlgSelector))
                .some((dialog) => Array.from(
                    dialog.querySelectorAll(labelSelector)
                ).some((span) => {
                    const text = String(span.textContent ?? "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .toLocaleLowerCase();
                    return text === targetText && visible(span.parentElement);
                }));
        },
        { timeout },
        dialogSelector,
        spanSelector,
        expected
    );
    await waitHuman("medium", timingOptions);
    const handle = await page.evaluateHandle(
        (dlgSelector, labelSelector, targetText) => {
            const visible = (node) => {
                if (!node) return false;
                const rectangle = node.getBoundingClientRect();
                const style = window.getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            for (const dialog of document.querySelectorAll(dlgSelector)) {
                for (const span of dialog.querySelectorAll(labelSelector)) {
                    const text = String(span.textContent ?? "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .toLocaleLowerCase();
                    if (text === targetText && visible(span.parentElement)) {
                        return span.parentElement;
                    }
                }
            }
            return null;
        },
        dialogSelector,
        spanSelector,
        expected
    );
    const element = handle.asElement();
    if (!element) {
        await handle.dispose().catch(() => {});
        throw new Error(`Не знайдено пункт «${expectedText}»`);
    }
    await clickHandle(page, element, timingOptions);
}
