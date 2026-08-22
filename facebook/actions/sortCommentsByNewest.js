import { postDialogSelector } from "../post/selectors.js";
import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import { waitForVisibleElement } from "../browser/elements.js";
import { waitHuman } from "../browser/timing.js";


export const commentOrderingButtonSelector =
    `${postDialogSelector} `
    + '[aria-expanded="false"][aria-haspopup="menu"]'
    + '[role="button"]:has(span)';
export const commentOrderingMenuSelector =
    '[aria-label="Comment Ordering"][role="menu"]';
export const commentOrderingMenuItemSelector =
    '[role="menuitem"]';

const currentOrderingText = "Most relevant";


async function getFirstVisibleElement(
    page,
    selector,
    requiredSpanText = null
) {
    const handle = await page.evaluateHandle(
        (candidateSelector, expectedText) => {
            const normalizeText = (text) => String(text ?? "")
                .replace(/\s+/g, " ")
                .trim();

            return Array.from(
                document.querySelectorAll(candidateSelector)
            ).find((element) => {
                const styles = window.getComputedStyle(element);
                const rectangle = element.getBoundingClientRect();
                const isVisible = rectangle.width > 0
                    && rectangle.height > 0
                    && styles.display !== "none"
                    && styles.visibility !== "hidden"
                    && styles.opacity !== "0";

                if (!isVisible) {
                    return false;
                }

                if (expectedText === null) {
                    return true;
                }

                return Array.from(
                    element.querySelectorAll("span")
                ).some((span) =>
                    normalizeText(span.textContent) === expectedText
                );
            }) ?? null;
        },
        selector,
        requiredSpanText
    );

    const element = handle.asElement();

    if (!element) {
        await handle.dispose();
        return null;
    }

    return element;
}


export default async function sortCommentsByNewest(page) {
    let orderingButton;
    let orderingMenu;
    let menuItems = [];

    try {
        console.log("Шукаємо кнопку сортування коментарів...");

        try {
            const postDialog = await waitForVisibleElement(
                page,
                postDialogSelector,
                { timeout: 15000 }
            );
            await postDialog.dispose();

            await page.waitForFunction(
                (selector, expectedText) => {
                    const normalizeText = (text) => String(text ?? "")
                        .replace(/\s+/g, " ")
                        .trim();

                    return Array.from(
                        document.querySelectorAll(selector)
                    ).some((element) => {
                        const styles = window.getComputedStyle(element);
                        const rectangle = element.getBoundingClientRect();
                        const isVisible = rectangle.width > 0
                            && rectangle.height > 0
                            && styles.display !== "none"
                            && styles.visibility !== "hidden"
                            && styles.opacity !== "0";

                        return isVisible && Array.from(
                            element.querySelectorAll("span")
                        ).some((span) =>
                            normalizeText(span.textContent) === expectedText
                        );
                    });
                },
                {
                    timeout: 15000,
                },
                commentOrderingButtonSelector,
                currentOrderingText
            );
        } catch {
            console.error(
                "Не вдалося знайти кнопку сортування коментарів за найновішими"
            );
            return false;
        }

        orderingButton = await getFirstVisibleElement(
            page,
            commentOrderingButtonSelector,
            currentOrderingText
        );

        if (!orderingButton) {
            console.error(
                "Не вдалося знайти кнопку сортування коментарів за найновішими"
            );
            return false;
        }

        console.log("Знайдено кнопку сортування Most relevant");
        console.log("Наводимо курсор на кнопку сортування...");

        if (!await moveMouseToElement(page, orderingButton, {
            scrollIntoView: false,
        })) {
            console.error(
                "Не вдалося визначити розташування кнопки сортування коментарів"
            );
            return false;
        }

        console.log("Очікуємо 1,5–3 секунди перед натисканням...");
        await waitHuman("medium");

        console.log("Натискаємо кнопку сортування лівою кнопкою миші...");
        await clickLeftMouse(page, {
            holdDelay: [70, 160],
        });

        console.log("Очікуємо 3–5 секунд після відкриття меню...");
        await waitHuman("long");

        console.log("Очікуємо появу меню Comment Ordering...");
        const visibleOrderingMenu = await waitForVisibleElement(
            page,
            commentOrderingMenuSelector,
            { timeout: 15000 }
        );
        await visibleOrderingMenu.dispose();

        orderingMenu = await getFirstVisibleElement(
            page,
            commentOrderingMenuSelector
        );

        if (!orderingMenu) {
            console.error("Не вдалося знайти меню Comment Ordering");
            return false;
        }

        menuItems = await orderingMenu.$$(
            commentOrderingMenuItemSelector
        );

        const newestCommentsItem = menuItems[1];

        if (!newestCommentsItem) {
            console.error(
                "Не вдалося знайти другий пункт у меню Comment Ordering"
            );
            return false;
        }

        console.log("Наводимо курсор на другий пункт меню...");

        if (!await moveMouseToElement(page, newestCommentsItem, {
            scrollIntoView: false,
        })) {
            console.error(
                "Не вдалося визначити розташування другого пункту меню"
            );
            return false;
        }

        console.log("Очікуємо 1,5–3 секунди перед натисканням...");
        await waitHuman("medium");

        console.log("Натискаємо другий пункт меню лівою кнопкою миші...");
        await clickLeftMouse(page, {
            holdDelay: [70, 160],
        });

        console.log("Очікуємо 7–10 секунд, поки коментарі завантажаться...");
        await waitHuman("extraLong");

        console.log("Коментарі успішно відсортовано за найновішими");
        return true;
    } catch (error) {
        console.error(
            "Не вдалося відсортувати коментарі за найновішими:",
            error.message
        );
        return false;
    } finally {
        await Promise.all(
            menuItems.map((item) =>
                item.dispose().catch(() => {})
            )
        );
        await orderingMenu?.dispose().catch(() => {});
        await orderingButton?.dispose().catch(() => {});
    }
}
