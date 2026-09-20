import { replyInputSelector } from "../selectors/post.js";
import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import { waitForVisibleElement } from "../browser/elements.js";
import { waitHuman, waitRandom } from "../browser/timing.js";


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
        '[role="article"]',
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


async function clickReplyButton(page, comment, searchText) {
    const replyButton = await getReplyButton(comment);
    let refreshedComment;
    let refreshedReplyButton;

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

        if (!await moveMouseToElement(page, replyButton, {
            scrollDelay: "short",
        })) {
            console.error(
                "Не вдалося визначити розташування кнопки Reply"
            );
            return false;
        }

        console.log("Стабілізуємо DOM перед повторним пошуком Reply...");
        await waitHuman("short");

        refreshedComment = await getMatchingComment(page, searchText);
        refreshedReplyButton = refreshedComment
            ? await getReplyButton(refreshedComment)
            : null;

        if (!refreshedReplyButton) {
            console.error("Не вдалося повторно знайти кнопку Reply");
            return false;
        }

        const movement = await moveMouseToElement(page, refreshedReplyButton, {
            scrollIntoView: false,
            inset: [0.5, 0.5],
        });
        const clickTargetMatches = await refreshedReplyButton.evaluate(
            (button, point) => {
                const target = document.elementFromPoint(point.x, point.y);
                return target === button || button.contains(target);
            },
            { x: movement.x, y: movement.y }
        );

        if (!clickTargetMatches) {
            console.error("Координата миші не потрапляє в кнопку Reply");
            return false;
        }

        console.log("Натискаємо на елемент Reply лівою кнопкою миші...");
        await clickLeftMouse(page, {
            beforeDelay: "short",
            holdDelay: [70, 160],
        });

        return true;
    } finally {
        await refreshedReplyButton?.dispose().catch(() => {});
        await refreshedComment?.dispose().catch(() => {});
        await replyButton.dispose().catch(() => {});
    }
}


async function getReplyInput(page) {
    const input = await waitForVisibleElement(
        page,
        replyInputSelector,
        { timeout: 15000 }
    );

    await input.focus();
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

        if (!await clickReplyButton(page, matchingComment, searchText)) {
            return false;
        }

        console.log("Очікуємо видиме поле reply...");
        replyInput = await getReplyInput(page);

        if (!replyInput) {
            console.error("Не вдалося знайти активне поле reply");
            return false;
        }

        console.log("Поле reply активне, вводимо текст...");
        await typeTextHumanLike(page, replyText);

        console.log("Очікуємо 2–4 секунди перед відправленням...");
        await waitHuman("long");

        console.log("Натискаємо Enter для відправлення reply...");
        await page.keyboard.press("Enter");

        console.log("Очікуємо 3–7 секунд після відправлення...");
        await waitHuman("veryLong");

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
