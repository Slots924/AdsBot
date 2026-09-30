import { createNewAccountSelector } from "../selectors/login.js";


async function detectLoginStatus(page) {
    const isLoginPage = await page.evaluate((selector) => (
        [...document.querySelectorAll(selector)].some((element) => {
            const rectangle = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        })
    ),
        createNewAccountSelector
    );

    if (isLoginPage) {
        console.log("Акаунт Facebook має статус LOGGED_OUT");
        return "LOGGED_OUT";
    }

    console.log("Акаунт Facebook має статус LOGGED_IN");
    return "LOGGED_IN";
}


export default detectLoginStatus;
