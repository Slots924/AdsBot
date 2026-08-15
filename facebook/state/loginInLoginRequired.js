import detectLoginStatus from "./detectLoginStatus.js";


async function waitRandom(minMilliseconds, maxMilliseconds) {
    const delay = Math.floor(
        Math.random() * (maxMilliseconds - minMilliseconds + 1)
    ) + minMilliseconds;

    await new Promise((resolve) => {
        setTimeout(resolve, delay);
    });
}


const loginButtonTexts = [
    "Log in",
    "Anmelden",
    "Se connecter",
    "Iniciar sesión",
    "Увійти",
    "Войти",
    "लॉग इन करें",
    "Giriş yap",
];


async function clickLoginButton(page) {
    const buttonFoundHandle = await page.waitForFunction((texts) => {
        const passwordInput = document.querySelector(
            '[type="password"][name="pass"]'
        );
        const searchRoot = passwordInput?.closest("form") ?? document;
        const candidates = searchRoot.querySelectorAll(
            'button, [role="button"], input[type="submit"]'
        );

        return Array.from(candidates).some((element) => {
            const styles = window.getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            const isVisible = rectangle.width > 0
                && rectangle.height > 0
                && styles.display !== "none"
                && styles.visibility !== "hidden"
                && styles.opacity !== "0";
            const buttonText = [
                element.getAttribute("aria-label"),
                element.textContent,
                element.getAttribute("value"),
            ].filter(Boolean).join(" ").toLocaleLowerCase();

            return isVisible && texts.some((text) =>
                buttonText.includes(text.toLocaleLowerCase())
            );
        });
    }, {
        timeout: 30000,
    }, loginButtonTexts);

    await buttonFoundHandle.dispose();

    const buttonHandle = await page.evaluateHandle((texts) => {
        const passwordInput = document.querySelector(
            '[type="password"][name="pass"]'
        );
        const searchRoot = passwordInput?.closest("form") ?? document;
        const candidates = searchRoot.querySelectorAll(
            'button, [role="button"], input[type="submit"]'
        );

        return Array.from(candidates).find((element) => {
            const styles = window.getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            const isVisible = rectangle.width > 0
                && rectangle.height > 0
                && styles.display !== "none"
                && styles.visibility !== "hidden"
                && styles.opacity !== "0";
            const buttonText = [
                element.getAttribute("aria-label"),
                element.textContent,
                element.getAttribute("value"),
            ].filter(Boolean).join(" ").toLocaleLowerCase();

            return isVisible && texts.some((text) =>
                buttonText.includes(text.toLocaleLowerCase())
            );
        }) ?? null;
    }, loginButtonTexts);
    const button = buttonHandle.asElement();

    if (!button) {
        await buttonHandle.dispose();
        return false;
    }

    try {
        const buttonData = await button.evaluate((element) => ({
            ariaLabel: element.getAttribute("aria-label"),
            text: element.textContent?.trim()
                || element.getAttribute("value")
                || "",
        }));

        console.log("Знайшли кнопку входу:", buttonData);

        await button.evaluate((element) => {
            element.scrollIntoView({
                block: "center",
                inline: "center",
            });
        });
        await button.click({ button: "left" });
        console.log("Натиснули кнопку входу");
        return true;
    } finally {
        await buttonHandle.dispose().catch(() => {});
    }
}


async function loginInLoginRequired(page) {
    console.log("Намагаємося увійти через loginInLoginRequired");

    try {
        await waitRandom(8000, 10000);

        const loginClicked = await clickLoginButton(page);

        if (!loginClicked) {
            console.log("Не вдалося знайти кнопку входу");
            return false;
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


export default loginInLoginRequired;
