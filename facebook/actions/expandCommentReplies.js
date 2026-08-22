import {
    commentButtonSelector,
    replyCommentSelector,
} from "../post/selectors.js";
import { clickLeftMouse, moveMouseToElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";


export const viewRepliesPattern =
    /^View(?: \d+)?(?: more| previous)? repl(?:y|ies)$/i;

const maxAttemptsWithoutProgress = 3;


async function getReplyState(page) {
    return page.evaluate(
        (buttonSelector, replySelector, patternSource, patternFlags) => {
            const pattern = new RegExp(patternSource, patternFlags);
            const normalizeText = (text) => String(text ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const buttons = Array.from(
                document.querySelectorAll(buttonSelector)
            ).filter((button) => {
                const styles = window.getComputedStyle(button);
                const rectangle = button.getBoundingClientRect();
                const isVisible = rectangle.width > 0
                    && rectangle.height > 0
                    && styles.display !== "none"
                    && styles.visibility !== "hidden"
                    && styles.opacity !== "0";

                return isVisible
                    && pattern.test(normalizeText(button.textContent));
            });

            return {
                buttonCount: buttons.length,
                firstButtonText: normalizeText(
                    buttons[0]?.textContent
                ),
                replyCount:
                    document.querySelectorAll(replySelector).length,
            };
        },
        commentButtonSelector,
        replyCommentSelector,
        viewRepliesPattern.source,
        viewRepliesPattern.flags
    );
}


async function getFirstVisibleReplyButton(page) {
    const handle = await page.evaluateHandle(
        (selector, patternSource, patternFlags) => {
            const pattern = new RegExp(patternSource, patternFlags);
            const normalizeText = (text) => String(text ?? "")
                .replace(/\s+/g, " ")
                .trim();

            return Array.from(
                document.querySelectorAll(selector)
            ).find((button) => {
                const styles = window.getComputedStyle(button);
                const rectangle = button.getBoundingClientRect();
                const isVisible = rectangle.width > 0
                    && rectangle.height > 0
                    && styles.display !== "none"
                    && styles.visibility !== "hidden"
                    && styles.opacity !== "0";

                return isVisible
                    && pattern.test(normalizeText(button.textContent));
            }) ?? null;
        },
        commentButtonSelector,
        viewRepliesPattern.source,
        viewRepliesPattern.flags
    );

    const button = handle.asElement();

    if (!button) {
        await handle.dispose();
        return null;
    }

    return button;
}


export default async function expandCommentReplies(page) {
    let attemptsWithoutProgress = 0;

    try {
        while (true) {
            const stateBeforeClick = await getReplyState(page);

            if (stateBeforeClick.buttonCount === 0) {
                console.log("Усі доступні replies уже розгорнуто");
                return true;
            }

            const replyButton = await getFirstVisibleReplyButton(page);

            if (!replyButton) {
                console.error(
                    "Не вдалося знайти видиму кнопку розгортання replies"
                );
                return false;
            }

            try {
                console.log(
                    `Розгортаємо replies: ${stateBeforeClick.firstButtonText}`
                );

                try {
                    await moveMouseToElement(page, replyButton);
                } catch {
                    console.error(
                        "Не вдалося визначити розташування кнопки replies"
                    );
                    return false;
                }

                console.log(
                    "Очікуємо 1,5–3 секунди перед натисканням..."
                );
                await waitHuman("medium");

                console.log(
                    "Натискаємо кнопку replies лівою кнопкою миші..."
                );
                await clickLeftMouse(page, {
                    holdDelay: [70, 160],
                });
            } finally {
                await replyButton.dispose().catch(() => {});
            }

            console.log("Очікуємо 2–4 секунди після натискання...");
            await waitHuman("long");

            const stateAfterClick = await getReplyState(page);
            const hasProgress =
                stateAfterClick.replyCount
                    > stateBeforeClick.replyCount
                || stateAfterClick.buttonCount
                    < stateBeforeClick.buttonCount
                || stateAfterClick.firstButtonText
                    !== stateBeforeClick.firstButtonText;

            if (hasProgress) {
                attemptsWithoutProgress = 0;
                continue;
            }

            attemptsWithoutProgress += 1;

            console.error(
                `Кнопка replies не дала результату. Спроба ${attemptsWithoutProgress}/${maxAttemptsWithoutProgress}`
            );

            if (
                attemptsWithoutProgress
                >= maxAttemptsWithoutProgress
            ) {
                console.error(
                    "Не вдалося розгорнути replies після трьох спроб"
                );
                return false;
            }
        }
    } catch (error) {
        console.error(
            "Не вдалося розгорнути replies:",
            error.message
        );
        return false;
    }
}
