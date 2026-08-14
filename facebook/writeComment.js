const commentInputSelector =
    'form[role="presentation"] div[contenteditable="true"][role="textbox"]';


function getRandomInteger(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


async function waitRandom(min, max) {
    const delay = getRandomInteger(min, max);

    await new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}


async function clickCommentInput(page) {
    await page.waitForSelector(commentInputSelector, {
        visible: true,
        timeout: 15000,
    });

    const input = await page.$(commentInputSelector);

    if (!input) {
        throw new Error("Не знайдено поле введення коментаря");
    }

    try {
        const box = await input.boundingBox();

        if (!box) {
            throw new Error(
                "Не вдалося визначити розташування поля введення коментаря"
            );
        }

        // Клікаємо у випадковій точці подалі від країв поля
        const x =
            box.x + box.width * (0.25 + Math.random() * 0.5);
        const y =
            box.y + box.height * (0.25 + Math.random() * 0.5);
        const steps = getRandomInteger(8, 18);

        await page.mouse.move(x, y, { steps });
        await waitRandom(60, 140);
        await page.mouse.down();
        await waitRandom(70, 160);
        await page.mouse.up();
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
        await waitRandom(4313, 7623);

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

        await waitRandom(3421, 5465);
        await page.keyboard.press("Enter");
        await waitRandom(2755, 4765);

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
