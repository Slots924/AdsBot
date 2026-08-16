import {
    allPostCommentSelector,
    replyInputSelector,
} from "../post/selectors.js";


const searchTextLength = 30;


export function normalizeCommentText(text) {
    return String(text ?? "")
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}


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


async function getMatchingComment(page, searchText) {
    const handle = await page.evaluateHandle(
        (selector, expectedText) => {
            const normalizeText = (text) => String(text ?? "")
                .normalize("NFKD")
                .replace(/\p{M}/gu, "")
                .toLocaleLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, " ")
                .replace(/\s+/g, " ")
                .trim();

            return Array.from(
                document.querySelectorAll(selector)
            ).find((article) =>
                normalizeText(article.innerText).includes(expectedText)
            ) ?? null;
        },
        allPostCommentSelector,
        searchText
    );

    const comment = handle.asElement();

    if (!comment) {
        await handle.dispose();
        return null;
    }

    return comment;
}


async function getReplyButton(comment) {
    const handle = await comment.evaluateHandle((article) => {
        const normalizeText = (text) => String(text ?? "")
            .normalize("NFKD")
            .replace(/\p{M}/gu, "")
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, " ")
            .replace(/\s+/g, " ")
            .trim();

        return Array.from(
            article.querySelectorAll('[role="button"]')
        ).find((button) => {
            const styles = window.getComputedStyle(button);
            const rectangle = button.getBoundingClientRect();
            const isVisible = rectangle.width > 0
                && rectangle.height > 0
                && styles.display !== "none"
                && styles.visibility !== "hidden"
                && styles.opacity !== "0";

            return isVisible
                && normalizeText(button.textContent) === "reply";
        }) ?? null;
    });

    const button = handle.asElement();

    if (!button) {
        await handle.dispose();
        return null;
    }

    return button;
}


async function moveMouseToElement(page, element) {
    await element.evaluate((target) => {
        target.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
        });
    });

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


async function clickReplyButton(page, comment) {
    const replyButton = await getReplyButton(comment);

    if (!replyButton) {
        console.error(
            "Не вдалося знайти кнопку Reply у потрібному коментарі"
        );
        return false;
    }

    try {
        console.log(
            "Переміщуємо кнопку Reply до центру екрана та наводимо мишу..."
        );

        if (!await moveMouseToElement(page, replyButton)) {
            console.error(
                "Не вдалося визначити розташування кнопки Reply"
            );
            return false;
        }

        console.log("Натискаємо на елемент Reply лівою кнопкою миші...");
        await replyButton.click({
            button: "left",
            delay: getRandomInteger(70, 160),
        });

        return true;
    } finally {
        await replyButton.dispose().catch(() => {});
    }
}


async function getActiveReplyInput(page) {
    const readyHandle = await page.waitForFunction(
        (selector) =>
            document.activeElement?.matches(selector) === true,
        {
            timeout: 15000,
        },
        replyInputSelector
    );

    await readyHandle.dispose();

    const handle = await page.evaluateHandle((selector) => {
        const activeElement = document.activeElement;

        return activeElement?.matches(selector)
            ? activeElement
            : null;
    }, replyInputSelector);

    const input = handle.asElement();

    if (!input) {
        await handle.dispose();
        return null;
    }

    return input;
}


async function typeTextHumanLike(page, text) {
    const normalizedNewLines = text.replace(/\r\n?/g, "\n");

    for (const character of Array.from(normalizedNewLines)) {
        if (character === "\n") {
            await page.keyboard.down("Shift");
            await page.keyboard.press("Enter");
            await page.keyboard.up("Shift");
        } else {
            await page.keyboard.type(character);
        }

        await waitRandom(120, 300);
    }
}


export default async function writeReply(
    page,
    targetCommentText,
    replyText
) {
    let matchingComment;
    let replyInput;

    try {
        if (
            typeof targetCommentText !== "string"
            || targetCommentText.trim().length === 0
        ) {
            console.error(
                "Текст коментаря для пошуку не може бути порожнім"
            );
            return false;
        }

        if (
            typeof replyText !== "string"
            || replyText.trim().length === 0
        ) {
            console.error("Текст reply не може бути порожнім");
            return false;
        }

        const normalizedTarget =
            normalizeCommentText(targetCommentText);
        const searchText = Array.from(normalizedTarget)
            .slice(0, searchTextLength)
            .join("");

        if (!searchText) {
            console.error(
                "Після нормалізації текст коментаря став порожнім"
            );
            return false;
        }

        console.log(
            `Шукаємо коментар за текстом: ${searchText}`
        );

        matchingComment = await getMatchingComment(
            page,
            searchText
        );

        if (!matchingComment) {
            console.error(
                `Не вдалося знайти коментар: "${targetCommentText}"`
            );
            return false;
        }

        console.log("Коментар знайдено, натискаємо кнопку Reply...");

        if (!await clickReplyButton(page, matchingComment)) {
            return false;
        }

        console.log("Очікуємо 1,5–3 секунди на появу поля reply...");
        await waitRandom(1500, 3000);

        replyInput = await getActiveReplyInput(page);

        if (!replyInput) {
            console.error("Не вдалося знайти активне поле reply");
            return false;
        }

        console.log("Поле reply активне, вводимо текст...");
        await typeTextHumanLike(page, replyText);

        console.log("Очікуємо 2–4 секунди перед відправленням...");
        await waitRandom(2000, 4000);

        console.log("Натискаємо Enter для відправлення reply...");
        await page.keyboard.press("Enter");

        console.log("Очікуємо 3–7 секунд після відправлення...");
        await waitRandom(3000, 7000);

        console.log("Reply успішно відправлено");
        return true;
    } catch (error) {
        console.error(
            "Не вдалося написати reply до коментаря:",
            error.message
        );
        return false;
    } finally {
        await replyInput?.dispose().catch(() => {});
        await matchingComment?.dispose().catch(() => {});
    }
}
