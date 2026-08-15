async function setPostReaction(page, reaction = "like") {
    const reactionButtonSelector =
        'div[role="dialog"][aria-modal="true"][aria-labelledby] div[data-visualcompletion="ignore-dynamic"] [aria-label]';
    const reactionsToolbarSelector =
        'div[data-visualcompletion="ignore-dynamic"][aria-label="Reactions"][role="dialog"] [role="toolbar"]';
    const reactionNames = {
        like: "Like",
        love: "Love",
        care: "Care",
        haha: "Haha",
        wow: "Wow",
        sad: "Sad",
        angry: "Angry",
    };

    const getRandomInteger = (min, max) =>
        Math.floor(Math.random() * (max - min + 1)) + min;

    // Очікуємо випадковий час у вказаному діапазоні
    const waitRandom = async (min, max) => {
        const delay = getRandomInteger(min, max);

        await new Promise((resolve) => {
            setTimeout(resolve, delay);
        });
    };

    // Плавно наводимо курсор на випадкову точку подалі від країв
    const moveMouseToElement = async (element) => {
        const box = await element.boundingBox();

        if (!box) {
            return null;
        }

        const xOffset = 0.25 + Math.random() * 0.5;
        const yOffset = 0.25 + Math.random() * 0.5;
        const point = {
            x: box.x + box.width * xOffset,
            y: box.y + box.height * yOffset,
        };
        const steps = getRandomInteger(14, 28);

        await page.mouse.move(
            point.x,
            point.y,
            { steps }
        );

        await waitRandom(60, 180);

        return point;
    };

    // Імітуємо окреме натискання та відпускання кнопки миші
    const clickWithMouse = async (element) => {
        const point = await moveMouseToElement(element);

        if (!point) {
            return false;
        }

        await page.mouse.down();

        await waitRandom(70, 170);

        await page.mouse.up();

        return true;
    };

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
            (selector) =>
                document.querySelector(selector)
                    ?.getAttribute("aria-label"),
            reactionButtonSelector
        );

        if (!currentReaction) {
            console.log("Не знайдено кнопку реакції");
            return false;
        }

        if (currentReaction !== "Like") {
            console.log(
                `Реакція вже стоїть: ${currentReaction}`
            );
            return false;
        }

        const reactionButton = await page.$(
            reactionButtonSelector
        );

        if (!reactionButton) {
            console.log("Не знайдено кнопку Like");
            return false;
        }

        if (selectedReaction === "like") {
            try {
                const clicked = await clickWithMouse(
                    reactionButton
                );

                if (!clicked) {
                    console.log(
                        "Не вдалося визначити розташування кнопки Like"
                    );
                    return false;
                }
            } finally {
                await reactionButton.dispose();
            }
        } else {
            try {
                const point = await moveMouseToElement(
                    reactionButton
                );

                if (!point) {
                    console.log(
                        "Не вдалося визначити розташування кнопки Like"
                    );
                    return false;
                }
            } finally {
                await reactionButton.dispose();
            }

            await waitRandom(1500, 3000);

            await page.waitForSelector(
                reactionsToolbarSelector,
                {
                    visible: true,
                    timeout: 15000,
                }
            );

            const reactionOptionSelector =
                `${reactionsToolbarSelector} [aria-label="${reactionName}"]`;

            await page.waitForSelector(
                reactionOptionSelector,
                {
                    visible: true,
                    timeout: 15000,
                }
            );

            const reactionOption = await page.$(
                reactionOptionSelector
            );

            if (!reactionOption) {
                console.log(
                    `Не знайдено реакцію ${reactionName}`
                );
                return false;
            }

            try {
                const clicked = await clickWithMouse(
                    reactionOption
                );

                if (!clicked) {
                    console.log(
                        `Не вдалося визначити розташування реакції ${reactionName}`
                    );
                    return false;
                }
            } finally {
                await reactionOption.dispose();
            }
        }

        await waitRandom(2000, 3000);

        const reactionAfterClick = await page.evaluate(
            (selector) =>
                document.querySelector(selector)
                    ?.getAttribute("aria-label"),
            reactionButtonSelector
        );
        const expectedLabel = `Remove ${reactionName}`;

        if (reactionAfterClick === expectedLabel) {
            console.log(
                `Реакцію ${reactionName} успішно поставлено`
            );
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
