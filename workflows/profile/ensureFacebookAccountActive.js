import dismissAutomatedBehavior from "../../facebook/actions/dismissAutomatedBehavior.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import markProfileAsBanned from "../../services/profile/tags/markProfileAsBanned.js";


export default async function ensureFacebookAccountActive(
    adsPower,
    profile,
    page
) {
    console.log(
        "Перевіряємо, чи Facebook-акаунт активний..."
    );

    try {
        let facebookState = await detectFacebookState(page);
        console.log(`Поточний стан Facebook: ${facebookState}`);

        if (facebookState === "AUTOMATED_BEHAVIOR") {
            console.log(
                "Виявлено automated behavior. Викликаємо Dismiss..."
            );

            const dismissSucceeded =
                await dismissAutomatedBehavior(page);
            console.log(
                `Результат dismissAutomatedBehavior: ${dismissSucceeded}`
            );

            facebookState = await detectFacebookState(page);
            console.log(
                `Стан Facebook після Dismiss: ${facebookState}`
            );
        }

        if (facebookState === "READY") {
            console.log("Facebook-акаунт активний");
            return true;
        }

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
        } else {
            console.error(
                `Facebook-акаунт не активний. Стан: ${facebookState}`
            );
        }

        return false;
    } catch (error) {
        console.error(
            "Не вдалося перевірити активність Facebook-акаунта:",
            error.message
        );
        return false;
    }
}
