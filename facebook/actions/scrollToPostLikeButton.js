import { humanScrollToSelector } from "../browser/scroll.js";
import { waitHuman } from "../browser/timing.js";
import { postLikeAreaSelector } from "../selectors/post.js";
import { storyMessageSelector } from "../selectors/post.js";


async function scrollToPostLikeButton(page) {
    try {
        const targetSelector = await page.evaluate(
            (likeSelector, storySelector) => {
                const visible = (element) => {
                    const rectangle = element.getBoundingClientRect();
                    const styles = window.getComputedStyle(element);
                    return rectangle.width > 0
                        && rectangle.height > 0
                        && styles.display !== "none"
                        && styles.visibility !== "hidden";
                };
                return Array.from(document.querySelectorAll(likeSelector)).some(visible)
                    ? likeSelector
                    : storySelector;
            },
            postLikeAreaSelector,
            storyMessageSelector
        );
        await humanScrollToSelector(page, targetSelector, {
            index: 0,
            timeout: 15000,
            position: "center",
            jitterPx: 50,
            durationMs: 800,
            stepRange: [10, 25],
        });
        return true;
    } catch {
        return false;
        // Помилка прокручування не повинна зупиняти основний сценарій.
    } finally {
        await waitHuman("extraLong");
    }
}


export default scrollToPostLikeButton;
