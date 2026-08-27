import { createNewAccountSelector } from "../selectors/login.js";


async function detectLoginStatus(page) {
    const isLoginPage = await page.evaluate(
        (selector) => Boolean(document.querySelector(selector)),
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
