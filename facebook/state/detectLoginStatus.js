import { createNewAccountLabels, createNewAccountSelector } from "../selectors/login.js";


async function detectLoginStatus(page) {
    const isLoginPage = await page.evaluate((selector, labels) => {
        const normalize = (text) => String(text ?? "").replace(/\s+/g, " ").trim()
            .normalize("NFC").toLocaleLowerCase().replace(/i\u0307/g, "i").replace(/ı/g, "i");
        // CSS-прапорець i не покриває зміну регістру кирилиці та інших не-ASCII написів.
        const candidates = new Set([
            ...document.querySelectorAll(selector),
            ...document.querySelectorAll('a[aria-label]'),
        ]);
        return [...candidates].some((element) => {
            if (!labels.some((label) => normalize(element.getAttribute("aria-label")) === normalize(label))) return false;
            const rectangle = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        });
    },
        createNewAccountSelector,
        createNewAccountLabels
    );

    if (isLoginPage) {
        console.log("Акаунт Facebook має статус LOGGED_OUT");
        return "LOGGED_OUT";
    }

    console.log("Акаунт Facebook має статус LOGGED_IN");
    return "LOGGED_IN";
}


export default detectLoginStatus;
