import { postDialogSelector } from "../post/selectors.js";


export const commentOrderingButtonSelector =
    `${postDialogSelector} `
    + '[aria-expanded="false"][aria-haspopup="menu"]'
    + '[role="button"]:has(span)';
export const commentOrderingMenuSelector =
    '[aria-label="Comment Ordering"][role="menu"]';
export const commentOrderingMenuItemSelector =
    '[role="menuitem"]';

const currentOrderingText = "Most relevant";


function getRandomInteger(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


async function wait(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}


async function waitRandom(min, max) {
    await wait(getRandomInteger(min, max));
}


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


async function moveMouseToElement(page, element) {
    const box = await element.boundingBox();

    if (!box) {
        return false;
    }

    const x =
        box.x + box.width * (0.25 + Math.random() * 0.5);
    const y =
        box.y + box.height * (0.25 + Math.random() * 0.5);

    await page.mouse.move(x, y, {
        steps: getRandomInteger(8, 18),
    });

    return true;
}


async function clickWithLeftMouseButton(page) {
    await page.mouse.down({ button: "left" });
    await waitRandom(70, 160);
    await page.mouse.up({ button: "left" });
}


export default async function sortCommentsByNewest(page) {
    let orderingButton;
    let orderingMenu;
    let menuItems = [];

    try {
        console.log("Шукаємо кнопку сортування коментарів...");

        try {
            await page.waitForSelector(postDialogSelector, {
                visible: true,
                timeout: 15000,
            });

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

        if (!await moveMouseToElement(page, orderingButton)) {
            console.error(
                "Не вдалося визначити розташування кнопки сортування коментарів"
            );
            return false;
        }

        console.log("Очікуємо 1,5–3 секунди перед натисканням...");
        await waitRandom(1500, 3000);

        console.log("Натискаємо кнопку сортування лівою кнопкою миші...");
        await clickWithLeftMouseButton(page);

        console.log("Очікуємо 3–5 секунд після відкриття меню...");
        await waitRandom(3000, 5000);

        console.log("Очікуємо появу меню Comment Ordering...");
        await page.waitForSelector(commentOrderingMenuSelector, {
            visible: true,
            timeout: 15000,
        });

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

        if (!await moveMouseToElement(page, newestCommentsItem)) {
            console.error(
                "Не вдалося визначити розташування другого пункту меню"
            );
            return false;
        }

        console.log("Очікуємо 1,5–3 секунди перед натисканням...");
        await waitRandom(1500, 3000);

        console.log("Натискаємо другий пункт меню лівою кнопкою миші...");
        await clickWithLeftMouseButton(page);

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
