import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../browser/elements.js";
import { waitHuman, waitRandom } from "../browser/timing.js";
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

        const currentReaction = await page.evaluate(
            (selector) => document.querySelector(selector)
                ?.getAttribute("aria-label"),
            reactionButtonSelector
        );

        if (!currentReaction) {
            console.log("Не знайдено кнопку реакції");
            return false;
        }

        if (currentReaction !== "Like") {
            console.log(`Реакція вже стоїть: ${currentReaction}`);
            return false;
        }

        const reactionButton = await getFirstVisibleElement(
            page,
            reactionButtonSelector
        );

        if (!reactionButton) {
            console.log("Не знайдено кнопку Like");
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
                { timeout: 15000 }
            );
            await toolbar.dispose();

            const reactionOptionSelector =
                getReactionOptionSelector(reactionName);

            const reactionOption = await waitForVisibleElement(
                page,
                reactionOptionSelector,
                { timeout: 15000 }
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
