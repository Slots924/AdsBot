import { humanScrollToSelector } from "../browser/scroll.js";
import { waitHuman } from "../browser/timing.js";
import { postLikeAreaSelector } from "../selectors/post.js";


async function scrollToPostLikeButton(page) {
    try {
        await humanScrollToSelector(page, postLikeAreaSelector, {
            index: 0,
            timeout: 15000,
            position: "center",
            jitterPx: 50,
            durationMs: 800,
            stepRange: [10, 25],
        });
    } catch {
        // Помилка прокручування не повинна зупиняти основний сценарій.
    } finally {
        await waitHuman("extraLong");
    }
}


export default scrollToPostLikeButton;
