import {
    postDialogSelector,
    topLevelCommentSelector,
} from "../selectors/post.js";
import { moveMouseToElement } from "../browser/pointer.js";
import {
    randomInteger,
    waitHuman,
    waitRandom,
} from "../browser/timing.js";


export default async function scrollCommentsDown(page) {
    let scrollContainer;

    try {
        const handle = await page.evaluateHandle(
            (dialogSelector, commentSelector) => {
                const dialog = document.querySelector(dialogSelector);
                const comments = Array.from(
                    document.querySelectorAll(commentSelector)
                );
                const lastComment = comments.at(-1);

                if (!dialog || !lastComment) {
                    return null;
                }

                let container = lastComment.parentElement;

                while (container && container !== document.body) {
                    const styles = window.getComputedStyle(container);
                    const canScroll = styles.overflowY === "auto"
                        || styles.overflowY === "scroll";

                    if (
                        canScroll
                        && container.scrollHeight > container.clientHeight
                    ) {
                        return container;
                    }

                    if (container === dialog) {
                        break;
                    }

                    container = container.parentElement;
                }

                return dialog;
            },
            postDialogSelector,
            topLevelCommentSelector
        );

        scrollContainer = handle.asElement();

        if (!scrollContainer) {
            await handle.dispose();
            console.error(
                "Не вдалося знайти контейнер для прокручування коментарів"
            );
            return false;
        }

        const box = await scrollContainer.boundingBox();

        if (!box) {
            console.error(
                "Не вдалося визначити розташування контейнера коментарів"
            );
            return false;
        }

        console.log("Наводимо курсор на область коментарів...");
        await moveMouseToElement(page, scrollContainer, {
            scrollIntoView: false,
            inset: [0.3, 0.7],
            steps: [8, 18],
        });
        await waitRandom(80, 180);

        const distanceFactor = randomInteger(65, 85) / 100;
        const scrollDistance = Math.max(
            240,
            Math.round(box.height * distanceFactor)
        );
        const wheelSteps = randomInteger(8, 15);
        let distanceLeft = scrollDistance;

        console.log("Прокручуємо коментарі вниз...");

        for (let index = 0; index < wheelSteps; index += 1) {
            const stepsLeft = wheelSteps - index;
            const averageStep = distanceLeft / stepsLeft;
            const stepFactor = randomInteger(80, 120) / 100;
            const deltaY = Math.max(
                12,
                Math.round(averageStep * stepFactor)
            );

            await page.mouse.wheel({ deltaY });
            distanceLeft = Math.max(0, distanceLeft - deltaY);
            await waitRandom(45, 120);
        }

        console.log(
            "Очікуємо 3–5 секунд для підвантаження коментарів..."
        );
        await waitHuman("long");

        return true;
    } catch (error) {
        console.error(
            "Не вдалося прокрутити коментарі вниз:",
            error.message
        );
        return false;
    } finally {
        await scrollContainer?.dispose().catch(() => {});
    }
}
