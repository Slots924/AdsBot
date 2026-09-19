import {
    availablePostSelector,
    storyMessageSelector,
} from "../../selectors/post.js";


export { availablePostSelector };


function emitLog(logger, level, message, fields = {}) {
    const method = logger?.[level];
    if (typeof method !== "function") return;

    try {
        method.call(logger, `[isPostAvailable] ${message}`, fields);
    } catch {
        // Помилка logger не повинна змінювати результат перевірки поста.
    }
}


async function waitForPostContent(page, selector, storySelector, logger) {
    if (typeof page.waitForFunction !== "function") return;

    emitLog(logger, "info", "Очікуємо до 5 секунд появу модального вікна поста", {
        selector,
        timeoutMs: 5_000,
    });

    try {
        await page.waitForFunction((postSelector, postStorySelector) => {
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const accessibleName = (dialog) => normalize(
                String(dialog.getAttribute("aria-labelledby") ?? "")
                    .split(" ")
                    .filter(Boolean)
                    .map((id) => document.getElementById(id)?.innerText)
                    .filter(Boolean)
                    .join(" ")
            );

            const dialogFound = Array.from(document.querySelectorAll(postSelector))
                .some((dialog) => visible(dialog)
                    && /['\u2019](?:s\s+)?post$/i.test(accessibleName(dialog)));
            const storyFound = Array.from(
                document.querySelectorAll(postStorySelector)
            ).some(visible);
            return dialogFound || storyFound;
        }, { timeout: 5_000 }, selector, storySelector);
    } catch (error) {
        if (error?.name !== "TimeoutError") throw error;

        emitLog(logger, "info", "Модальне вікно поста не з'явилося за 5 секунд", {
            selector,
        });
    }
}


export default async function isPostAvailable(
    page,
    { logger = console } = {}
) {
    try {
        emitLog(logger, "info", "Шукаємо видиме модальне вікно поста", {
            selector: availablePostSelector,
        });
        await waitForPostContent(
            page,
            availablePostSelector,
            storyMessageSelector,
            logger
        );
        const result = await page.evaluate((selector, storySelector) => {
            const normalize = (value) => String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const visible = (node) => {
                const rectangle = node.getBoundingClientRect();
                const style = getComputedStyle(node);
                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            };
            const accessibleName = (dialog) => {
                const labelledBy = normalize(
                    dialog.getAttribute("aria-labelledby")
                );
                return normalize(labelledBy.split(" ")
                    .filter(Boolean)
                    .map((id) => document.getElementById(id)?.innerText)
                    .filter(Boolean)
                    .join(" "));
            };
            const unavailablePattern = /(?:content (?:isn't|is not) available|this post is no longer available|content unavailable)/i;
            const unavailableText = Array.from(document.querySelectorAll(
                '[role="dialog"], [role="main"]'
            ))
                .filter(visible)
                .map((node) => normalize(node.innerText))
                .find((text) => unavailablePattern.test(text)) ?? null;
            const dialog = Array.from(document.querySelectorAll(selector))
                .filter(visible)
                .find((candidate) => /['\u2019](?:s\s+)?post$/i.test(
                    accessibleName(candidate)
                ));
            const storyMessage = Array.from(
                document.querySelectorAll(storySelector)
            ).find(visible);

            return {
                available: Boolean(dialog || storyMessage) && !unavailableText,
                dialogFound: Boolean(dialog),
                storyFound: Boolean(storyMessage),
                dialogName: dialog ? accessibleName(dialog) : null,
                unavailableText,
            };
        }, availablePostSelector, storyMessageSelector);

        if (result.available) {
            emitLog(logger, "info", "Модальне вікно доступного поста знайдено", {
                selector: availablePostSelector,
                dialogName: result.dialogName,
            });
            return true;
        }

        emitLog(logger, "error", "Facebook-пост недоступний", {
            selector: availablePostSelector,
            dialogFound: result.dialogFound,
            storyFound: result.storyFound,
            unavailableText: result.unavailableText,
        });
        return false;
    } catch (error) {
        emitLog(logger, "error", "Не вдалося перевірити Facebook-пост", {
            selector: availablePostSelector,
            error: error.message,
        });
        return false;
    }
}
