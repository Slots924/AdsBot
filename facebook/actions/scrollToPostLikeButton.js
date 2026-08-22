import { humanScrollToSelector } from "../browser/scroll.js";
import { waitHuman } from "../browser/timing.js";


const postLikeAreaSelector =
    'div[role="dialog"] div[class^="html-div"] > * '
    + '> div[data-visualcompletion="ignore-dynamic"] '
    + '> div > div:nth-of-type(1)';


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
