import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import { commentInputSelector } from "../selectors/post.js";


async function clickCommentInput(page) {
    const input = await waitForVisibleElement(page, commentInputSelector, {
        timeout: 15000,
    });

    try {
        await humanClickElement(page, input, {
            beforeDelay: [60, 140],
            holdDelay: [70, 160],
        });
    } finally {
        await input.dispose();
    }
}


async function writeComment(page, commentText) {
    if (
        typeof commentText !== "string" ||
        commentText.trim().length === 0
    ) {
        throw new Error("Текст коментаря не може бути порожнім");
    }

    try {
        await clickCommentInput(page);
        await waitHuman("veryLong");

        await page.evaluate(
            async (selector, text) => {
                // Проста пауза між введенням символів
                const sleep = (milliseconds) =>
                    new Promise((resolve) => {
                        setTimeout(resolve, milliseconds);
                    });

                const inputBox = document.querySelector(selector);

                if (!inputBox) {
                    throw new Error(
                        "Не знайдено поле введення коментаря"
                    );
                }

                inputBox.focus();

                // Вводимо коментар посимвольно
                for (const char of text) {
                    if (char === "\n") {
                        const shiftEnterEvent = new KeyboardEvent(
                            "keydown",
                            {
                                bubbles: true,
                                cancelable: true,
                                key: "Enter",
                                code: "Enter",
                                keyCode: 13,
                                shiftKey: true,
                            }
                        );

                        inputBox.dispatchEvent(shiftEnterEvent);
                        inputBox.dispatchEvent(
                            new InputEvent("input", {
                                bubbles: true,
                            })
                        );
                    } else {
                        document.execCommand(
                            "insertText",
                            false,
                            char
                        );
                    }

                    await sleep(250);
                }
            },
            commentInputSelector,
            commentText
        );

        await waitHuman("long");
        await page.keyboard.press("Enter");
        await waitHuman("long");

        return true;
    } catch (error) {
        console.error(
            "Не вдалося написати коментар:",
            error.message
        );
        return false;
    }
}


export default writeComment;
