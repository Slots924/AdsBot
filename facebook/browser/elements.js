export class BrowserElementError extends Error {
    constructor(message, {
        code = "BROWSER_ELEMENT_ERROR",
        selector = null,
        timeoutMs = null,
        index = null,
        cause = null,
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "BrowserElementError";
        this.code = code;
        this.selector = selector;
        this.timeoutMs = timeoutMs;
        this.index = index;
    }
}


function validateSelector(selector) {
    if (typeof selector !== "string" || selector.trim() === "") {
        throw new TypeError("Селектор елемента не може бути порожнім");
    }
}


function validateIndex(index) {
    if (index !== null && (!Number.isInteger(index) || index < 0)) {
        throw new RangeError(
            `Індекс елемента має бути невід’ємним цілим числом: ${index}`
        );
    }
}


export async function getFirstVisibleElement(
    page,
    selector,
    { index = null } = {}
) {
    validateSelector(selector);
    validateIndex(index);

    const handle = await page.evaluateHandle(
        (targetSelector, targetIndex) => {
            const elements = Array.from(
                document.querySelectorAll(targetSelector)
            );
            const candidates = targetIndex === null
                ? elements
                : [elements[targetIndex]].filter(Boolean);

            return candidates.find((element) => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            }) ?? null;
        },
        selector,
        index
    );
    const element = handle.asElement();

    if (!element) {
        await handle.dispose();
        return null;
    }

    return element;
}


export async function waitForVisibleElement(
    page,
    selector,
    { timeout = 15000, index = null } = {}
) {
    validateSelector(selector);
    validateIndex(index);

    let readyHandle;

    try {
        readyHandle = await page.waitForFunction(
            (targetSelector, targetIndex) => {
                const elements = Array.from(
                    document.querySelectorAll(targetSelector)
                );
                const candidates = targetIndex === null
                    ? elements
                    : [elements[targetIndex]].filter(Boolean);

                return candidates.some((element) => {
                    const rectangle = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);

                    return rectangle.width > 0
                        && rectangle.height > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && style.opacity !== "0";
                });
            },
            { timeout },
            selector,
            index
        );
    } catch (error) {
        throw new BrowserElementError(
            `Не знайдено видимий елемент: ${selector}`,
            {
                code: "BROWSER_ELEMENT_TIMEOUT",
                selector,
                timeoutMs: timeout,
                index,
                cause: error,
            }
        );
    } finally {
        await readyHandle?.dispose().catch(() => {});
    }

    const element = await getFirstVisibleElement(page, selector, { index });

    if (!element) {
        throw new BrowserElementError(
            `Елемент зник після очікування: ${selector}`,
            {
                code: "BROWSER_ELEMENT_DISAPPEARED",
                selector,
                timeoutMs: timeout,
                index,
            }
        );
    }

    return element;
}
