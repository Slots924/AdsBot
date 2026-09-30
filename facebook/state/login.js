import { waitForVisibleElement } from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { waitHuman } from "../browser/timing.js";
import {
    logInButtonSelector,
    useAnotherProfileSelector,
} from "../selectors/login.js";
import detectLoginStatus from "./detectLoginStatus.js";
import fillLoginCredentials from "./fillLoginCredentials.js";


const passwordInputSelector = 'input[type="password"]';


async function clickSelector(page, selector, timeout, timingOptions) {
    const initial = await waitForVisibleElement(page, selector, { timeout });
    await initial.dispose().catch(() => {});
    await waitHuman("medium", timingOptions);
    const fresh = await waitForVisibleElement(page, selector, { timeout });

    try {
        await humanClickElement(page, fresh, {
            beforeDelay: [100, 260],
            holdDelay: [80, 170],
            scrollDelay: [900, 1600],
            ...timingOptions,
        });
    } finally {
        await fresh.dispose().catch(() => {});
    }
}


async function waitForLoginFormToDisappear(page, timeout) {
    let completionHandle;

    try {
        completionHandle = await page.waitForFunction((selector) => {
            return ![...document.querySelectorAll(selector)].some((element) => {
                const rectangle = element.getBoundingClientRect();
                const style = window.getComputedStyle(element);

                return rectangle.width > 0
                    && rectangle.height > 0
                    && style.display !== "none"
                    && style.visibility !== "hidden"
                    && style.opacity !== "0";
            });
        }, { timeout }, passwordInputSelector);
    } finally {
        await completionHandle?.dispose().catch(() => {});
    }
}


export default async function login(
    page,
    {
        timeout = 30000,
        completionTimeout = 15000,
        random = Math.random,
        sleep,
    } = {}
) {
    console.log("Намагаємося увійти в акаунт Facebook");

    const timingOptions = {
        random,
        ...(sleep ? { sleep } : {}),
    };

    try {
        let readyHandle;

        try {
            readyHandle = await page.waitForFunction(
                (useAnotherSelector, logInSelector) =>
                    Boolean(document.querySelector(useAnotherSelector))
                    || Boolean(document.querySelector(logInSelector)),
                { timeout },
                useAnotherProfileSelector,
                logInButtonSelector
            );
        } finally {
            await readyHandle?.dispose().catch(() => {});
        }

        const needsAnotherProfile = await page.evaluate(
            (selector) => Boolean(document.querySelector(selector)),
            useAnotherProfileSelector
        );

        if (needsAnotherProfile) {
            console.log(
                "Знайшли вибір акаунтів, натискаємо інший профіль"
            );
            await clickSelector(
                page,
                useAnotherProfileSelector,
                timeout,
                timingOptions
            );
            await waitHuman("medium", timingOptions);
        }

        const loginButton = await waitForVisibleElement(
            page,
            logInButtonSelector,
            { timeout }
        );
        await loginButton.dispose().catch(() => {});

        console.log("Заповнюємо логін і пароль");
        await fillLoginCredentials(page, timingOptions);

        console.log("Натискаємо кнопку входу");
        await clickSelector(
            page,
            logInButtonSelector,
            timeout,
            timingOptions
        );

        console.log("Чекаємо, доки видима форма входу зникне");
        await waitForLoginFormToDisappear(
            page,
            Math.min(timeout, completionTimeout)
        );

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
