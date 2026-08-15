import {
    postDialogSelector,
    topLevelCommentSelector,
} from "../post/selectors.js";


function getRandomInteger(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}


async function wait(milliseconds) {
    await new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}


async function waitRandom(min, max) {
    await wait(getRandomInteger(min, max));
}


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

                while (
                    container
                    && container !== document.body
                ) {
                    const styles = window.getComputedStyle(container);
                    const canScroll =
                        styles.overflowY === "auto"
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

        const x =
            box.x + box.width * (0.3 + Math.random() * 0.4);
        const y =
            box.y + box.height * (0.3 + Math.random() * 0.4);

        console.log("Наводимо курсор на область коментарів...");
        await page.mouse.move(x, y, {
            steps: getRandomInteger(8, 18),
        });
        await waitRandom(80, 180);

        const scrollDistance = Math.max(
            240,
            Math.round(box.height * (0.65 + Math.random() * 0.2))
        );
        const wheelSteps = getRandomInteger(8, 15);
        let distanceLeft = scrollDistance;

        console.log("Прокручуємо коментарі вниз...");

        for (let index = 0; index < wheelSteps; index += 1) {
            const stepsLeft = wheelSteps - index;
            const averageStep = distanceLeft / stepsLeft;
            const deltaY = Math.max(
                12,
                Math.round(
                    averageStep * (0.8 + Math.random() * 0.4)
                )
            );

            await page.mouse.wheel({ deltaY });
            distanceLeft = Math.max(0, distanceLeft - deltaY);
            await waitRandom(45, 120);
        }

        console.log(
            "Очікуємо 3–5 секунд для підвантаження коментарів..."
        );
        await waitRandom(3000, 5000);

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
