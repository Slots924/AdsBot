import ensureLogin from "../../facebook/state/ensureLogin.js";
import markProfileAsBanned from "../../services/profile/tags/markProfileAsBanned.js";
import markProfileAsLoginError from "../../services/profile/tags/markProfileAsLoginError.js";

import ensureFacebookAccountReady from "./ensureFacebookAccountReady.js";


export default async function ensureFacebookAccountLoggedIn(
    adsPower,
    profile,
    page
) {
    console.log("=== Перевірка готовності профілю до роботи ===");

    try {
        console.log("Перевіряємо вхід у Facebook...");
        const loginSucceeded = await ensureLogin(page);
        console.log(`Результат ensureLogin: ${loginSucceeded}`);

        if (!loginSucceeded) {
            console.error("Не вдалося забезпечити вхід у Facebook");
            console.log("Додаємо профілю тег Login Error...");

            try {
                const markResult = await markProfileAsLoginError(
                    adsPower,
                    profile
                );
                console.log(
                    "Результат маркування Login Error:",
                    markResult
                );
            } catch (error) {
                console.error(
                    "Не вдалося додати тег Login Error:",
                    error.message
                );
            }

            return false;
        }

        console.log("Вхід у Facebook підтверджено");
        const facebookState = await ensureFacebookAccountReady(page);
        console.log(
            `Результат ensureFacebookAccountReady: ${facebookState}`
        );

        if (facebookState === "BANNED") {
            console.error("Facebook-акаунт заблокований");
            console.log("Додаємо профілю тег BAN...");

            try {
                const markResult = await markProfileAsBanned(
                    adsPower,
                    profile
                );
                console.log(
                    "Результат маркування BAN:",
                    markResult
                );
            } catch (error) {
                console.error(
                    "Не вдалося додати тег BAN:",
                    error.message
                );
            }

            return false;
        }

        if (facebookState === "READY") {
            console.log("Профіль готовий до роботи");
            return true;
        }

        console.error(
            `Профіль не готовий до роботи. Стан: ${facebookState}`
        );
        return false;

    } catch (error) {
        console.error(
            "Помилка перевірки готовності профілю:",
            error.message
        );
        return false;
    }
}
