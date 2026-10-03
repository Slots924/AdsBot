import dismissAutomatedBehavior from "../../facebook/actions/dismissAutomatedBehavior.js";
import fixAccountLock from "../../facebook/actions/fixAccountLock.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import markProfileAsBanned from "../../services/profile/tags/markProfileAsBanned.js";


export default async function ensureFacebookAccountActive(
    adsPower,
    profile,
    page,
    options = {}
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

        if (facebookState === "ACCOUNT_LOCK") {
            const fixSucceeded = await fixAccountLock(page, { ...options, adsPower, profile });
            console.log(`Результат fixAccountLock: ${fixSucceeded}`);

            facebookState = await detectFacebookState(page);
            console.log(`Стан Facebook після fixAccountLock: ${facebookState}`);
            if (!fixSucceeded) return false;
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
