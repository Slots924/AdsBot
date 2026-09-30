import ensureLogin from "../../facebook/state/ensureLogin.js";
import markProfileAsLoginError from "../../services/profile/tags/markProfileAsLoginError.js";


export default async function ensureFacebookAccountLoggedIn(
    adsPower,
    profile,
    page
) {
    console.log("=== Перевірка входу у Facebook ===");

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
        return true;

    } catch (error) {
        console.error(
            "Помилка перевірки входу у Facebook:",
            error.message
        );
        return false;
    }
}
