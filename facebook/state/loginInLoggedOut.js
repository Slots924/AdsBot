import detectLoginStatus, {
    loggedOutLabels,
} from "./detectLoginStatus.js";


async function waitRandom(minMilliseconds, maxMilliseconds) {
    const delay = Math.floor(
        Math.random() * (maxMilliseconds - minMilliseconds + 1)
    ) + minMilliseconds;

    await new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}


async function clickContinueButton(page) {
    const continueTexts = loggedOutLabels.map(
        (labels) => labels.continueText
    );
    const buttonFoundHandle = await page.waitForFunction((texts) => {
        return Array.from(
            document.querySelectorAll('[role="button"][aria-label]')
        ).some((element) => {
            const ariaLabel = element.getAttribute("aria-label")?.trim();
            const styles = window.getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            const isVisible = rectangle.width > 0
                && rectangle.height > 0
                && styles.display !== "none"
                && styles.visibility !== "hidden"
                && styles.opacity !== "0";

            return isVisible && texts.some((text) => ariaLabel
                    ?.toLocaleLowerCase()
                    .includes(text.toLocaleLowerCase()));
        });
    }, {
        timeout: 30000,
    }, continueTexts);

    await buttonFoundHandle.dispose();

    const buttonHandle = await page.evaluateHandle((texts) => {
        return Array.from(
            document.querySelectorAll('[role="button"][aria-label]')
        ).find((element) => {
            const ariaLabel = element.getAttribute("aria-label")?.trim();
            const styles = window.getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            const isVisible = rectangle.width > 0
                && rectangle.height > 0
                && styles.display !== "none"
                && styles.visibility !== "hidden"
                && styles.opacity !== "0";

            return isVisible && texts.some((text) => ariaLabel
                    ?.toLocaleLowerCase()
                    .includes(text.toLocaleLowerCase()));
        }) ?? null;
    }, continueTexts);
    const button = buttonHandle.asElement();

    if (!button) {
        await buttonHandle.dispose();
        return false;
    }

    const ariaLabel = await button.evaluate((element) =>
        element.getAttribute("aria-label")
    );

    console.log(`Знайшли кнопку продовження входу: ${ariaLabel}`);

    try {
        await button.evaluate((element) => {
            element.scrollIntoView({
                block: "center",
                inline: "center",
            });
        });
        await button.click({ button: "left" });
        console.log("Натиснули кнопку продовження входу");
        return true;
    } finally {
        await buttonHandle.dispose().catch(() => {});
    }
}


async function loginInLoggedOut(page) {
    console.log("Намагаємося увійти через loginInLoggedOut");

    try {
        await waitRandom(3000, 5000);

        const continueClicked = await clickContinueButton(page);

        if (!continueClicked) {
            console.log("Не вдалося знайти кнопку продовження входу");
            return false;
        }

        await waitRandom(3000, 5000);

        const passwordFormButtonSelector =
            'form#aymh_password_entry_view[method="POST"][novalidate] '
            + '[role="button"]';
        let buttonsReadyHandle;

        try {
            buttonsReadyHandle = await page.waitForFunction(
                (selector) =>
                    document.querySelectorAll(selector).length >= 2,
                {
                    timeout: 30000,
                },
                passwordFormButtonSelector
            );
        } catch {
            const availableButtons = await page.$$(
                passwordFormButtonSelector
            );

            console.log(
                `Знайдено кнопок у формі входу: ${availableButtons.length}`
            );
            await Promise.allSettled(
                availableButtons.map((button) => button.dispose())
            );
            console.log(
                "Не вдалося дочекатися другої кнопки підтвердження входу"
            );
            return false;
        } finally {
            await buttonsReadyHandle?.dispose().catch(() => {});
        }

        const passwordFormButtons = await page.$$(
            passwordFormButtonSelector
        );

        console.log(
            `Знайдено кнопок у формі входу: ${passwordFormButtons.length}`
        );

        if (passwordFormButtons.length < 2) {
            await Promise.allSettled(
                passwordFormButtons.map((button) => button.dispose())
            );
            console.log("Другу кнопку підтвердження входу не знайдено");
            return false;
        }

        const passwordFormButton = passwordFormButtons[1];

        try {
            const buttonData = await passwordFormButton.evaluate((element) => {
                const styles = window.getComputedStyle(element);
                const rectangle = element.getBoundingClientRect();

                return {
                    ariaLabel: element.getAttribute("aria-label"),
                    isVisible: rectangle.width > 0
                        && rectangle.height > 0
                        && styles.display !== "none"
                        && styles.visibility !== "hidden"
                        && styles.opacity !== "0",
                    text: element.textContent?.trim() ?? "",
                };
            });

            console.log(
                "Друга кнопка форми входу:",
                {
                    ariaLabel: buttonData.ariaLabel,
                    text: buttonData.text,
                }
            );

            if (!buttonData.isVisible) {
                console.log("Друга кнопка підтвердження входу невидима");
                return false;
            }

            await passwordFormButton.evaluate((element) => {
                element.scrollIntoView({
                    block: "center",
                    inline: "center",
                });
            });

            await waitRandom(7000, 10000);
            await passwordFormButton.click({ button: "left" });
            console.log("Натиснули другу кнопку підтвердження входу");
        } finally {
            await Promise.allSettled(
                passwordFormButtons.map((button) => button.dispose())
            );
        }

        await waitRandom(7000, 10000);

        const loginStatus = await detectLoginStatus(page);

        if (loginStatus === "LOGGED_IN") {
            console.log("Успішно увійшли в акаунт Facebook");
            return true;
        }

        console.log(
            `Не вдалося увійти в акаунт Facebook. Статус: ${loginStatus}`
        );
        return false;
    } catch (error) {
        console.log(
            `Не вдалося увійти в акаунт Facebook: ${error.message}`
        );
        return false;
    }
}


export default loginInLoggedOut;
