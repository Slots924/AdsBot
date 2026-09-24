import { getFirstVisibleElement } from "../browser/elements.js";
import { humanScrollToElement } from "../browser/scroll.js";
import { wait } from "../browser/timing.js";
import {
    postDialogSelector,
    postLikeAreaSelector,
} from "../selectors/post.js";


const lazyScrollAttempts = 6;
const lazyScrollStepPx = 480;
const lazyScrollDelayMs = 200;


async function scrollDialogDown(page) {
    return page.evaluate((dialogSelector, stepPx) => {
        const dialog = document.querySelector(dialogSelector);
        if (!dialog) return false;

        const scrollContainer = [dialog, ...dialog.querySelectorAll("*")]
            .find((element) => {
                const styles = window.getComputedStyle(element);
                const canScroll = styles.overflowY === "auto"
                    || styles.overflowY === "scroll";

                return canScroll && element.scrollHeight > element.clientHeight;
            });

        if (scrollContainer) {
            scrollContainer.scrollBy({ top: stepPx, behavior: "smooth" });
        } else {
            window.scrollBy({ top: stepPx, behavior: "smooth" });
        }

        return true;
    }, postDialogSelector, lazyScrollStepPx);
}


async function scrollToPostLikeButton(page) {
    try {
        for (let attempt = 1; attempt <= lazyScrollAttempts; attempt += 1) {
            const likeButton = await getFirstVisibleElement(
                page,
                postLikeAreaSelector
            );

            if (likeButton) {
                try {
                    await humanScrollToElement(page, likeButton, {
                        position: "center",
                        jitterPx: 20,
                        durationMs: 500,
                        stepRange: [10, 20],
                    });
                    console.log(`Кнопку реакції знайдено на спробі ${attempt}/${lazyScrollAttempts}`);
                    return true;
                } finally {
                    await likeButton.dispose().catch(() => {});
                }
            }

            console.log(`Шукаємо кнопку реакції: прокрутка ${attempt}/${lazyScrollAttempts}`);
            if (!await scrollDialogDown(page)) return false;
            await wait(lazyScrollDelayMs);
        }

        console.log("Кнопку реакції не знайдено після лінивої прокрутки");
        return false;
    } catch {
        return false;
        // Помилка прокручування не повинна зупиняти основний сценарій.
    }
}


export default scrollToPostLikeButton;
