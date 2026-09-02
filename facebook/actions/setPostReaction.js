import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../browser/elements.js";
import { waitForDomQuiet } from "../browser/confirmedClick.js";
import { wait, waitHuman, waitRandom } from "../browser/timing.js";
import {
    getReactionOptionSelector,
    reactionButtonSelector,
    reactionsToolbarSelector,
} from "../selectors/reactions.js";
const reactionNames = {
    like: "Like",
    love: "Love",
    care: "Care",
    haha: "Haha",
    wow: "Wow",
    sad: "Sad",
    angry: "Angry",
};
const reactionButtonTimeout = 15000;
const reactionDomQuietTimeout = 5000;
const reactionDomQuietMs = 300;


async function isElementReady(element) {
    return element.evaluate((target) => {
        if (!target?.isConnected) {
            return false;
        }

        const rectangle = target.getBoundingClientRect();
        const style = window.getComputedStyle(target);

        return rectangle.width > 0
            && rectangle.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0";
    });
}


async function moveToReaction(page, element) {
    const moved = await moveMouseToElement(page, element, {
        scrollIntoView: false,
        steps: [14, 28],
    });

    await waitRandom(60, 180);

    return moved || null;
}


async function clickReaction(page, element) {
    if (!await moveToReaction(page, element)) {
        return false;
    }

    if (!await isElementReady(element)) {
        return false;
    }

    await clickLeftMouse(page, {
        holdDelay: [70, 170],
    });
    return true;
}


async function setPostReaction(page, reaction = "like") {
    try {
        const selectedReaction = String(reaction).toLowerCase();
        const reactionName = reactionNames[selectedReaction];

        if (!reactionName) {
            console.log(
                `Невідома реакція: ${reaction}. Доступні реакції: ${Object.keys(reactionNames).join(", ")}`
            );
            return false;
        }

        await wait(2000);

        const initialReactionButton = await waitForVisibleElement(
            page,
            reactionButtonSelector,
            { timeout: reactionButtonTimeout }
        );
        await initialReactionButton.dispose();

        await waitForDomQuiet(
            page,
            { selector: reactionButtonSelector },
            {
                quietMs: reactionDomQuietMs,
                timeout: reactionDomQuietTimeout,
            }
        );
        const reactionButton = await getFirstVisibleElement(
            page,
            reactionButtonSelector
        );

        if (!reactionButton) {
            console.log("Не знайдено кнопку Like");
            return false;
        }

        const currentReaction = await reactionButton.evaluate(
            (target) => target.getAttribute("aria-label")
        );
        if (!currentReaction) {
            await reactionButton.dispose();
            console.log("Не знайдено кнопку реакції");
            return false;
        }

        if (currentReaction !== "Like") {
            await reactionButton.dispose();
            console.log(`Реакція вже стоїть: ${currentReaction}`);
            return false;
        }

        if (selectedReaction === "like") {
            try {
                if (!await clickReaction(page, reactionButton)) {
                    console.log("Не вдалося визначити розташування кнопки Like");
                    return false;
                }
            } finally {
                await reactionButton.dispose();
            }
        } else {
            try {
                if (!await moveToReaction(page, reactionButton)) {
                    console.log("Не вдалося визначити розташування кнопки Like");
                    return false;
                }
            } finally {
                await reactionButton.dispose();
            }

            await waitHuman("medium");
            const toolbar = await waitForVisibleElement(
                page,
                reactionsToolbarSelector,
                { timeout: reactionButtonTimeout }
            );
            await toolbar.dispose();

            const reactionOptionSelector =
                getReactionOptionSelector(reactionName);

            const initialReactionOption = await waitForVisibleElement(
                page,
                reactionOptionSelector,
                { timeout: reactionButtonTimeout }
            );
            await initialReactionOption.dispose();

            await waitForDomQuiet(
                page,
                { selector: reactionOptionSelector },
                {
                    quietMs: reactionDomQuietMs,
                    timeout: reactionDomQuietTimeout,
                }
            );
            const reactionOption = await getFirstVisibleElement(
                page,
                reactionOptionSelector
            );

            if (!reactionOption) {
                console.log(`Не знайдено реакцію ${reactionName}`);
                return false;
            }

            try {
                if (!await clickReaction(page, reactionOption)) {
                    console.log(
                        `Не вдалося визначити розташування реакції ${reactionName}`
                    );
                    return false;
                }
            } finally {
                await reactionOption.dispose();
            }
        }

        await waitHuman("medium");
        const reactionAfterClick = await page.evaluate(
            (selector) => document.querySelector(selector)
                ?.getAttribute("aria-label"),
            reactionButtonSelector
        );
        const expectedLabel = `Remove ${reactionName}`;

        if (reactionAfterClick === expectedLabel) {
            console.log(`Реакцію ${reactionName} успішно поставлено`);
            return true;
        }

        console.log(
            `Реакцію ${reactionName} не поставлено. Поточне значення aria-label: ${reactionAfterClick}`
        );
        return false;
    } catch (error) {
        console.error(
            "Не вдалося поставити реакцію, продовжуємо роботу:",
            error.message
        );
        return false;
    }
}


export default setPostReaction;
