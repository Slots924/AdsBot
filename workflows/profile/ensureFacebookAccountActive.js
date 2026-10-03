import dismissAutomatedBehavior from "../../facebook/actions/dismissAutomatedBehavior.js";
import fixAccountLock from "../../facebook/actions/fixAccountLock.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import markProfileAsBanned from "../../services/profile/tags/markProfileAsBanned.js";
import markProfileAsLoginError from "../../services/profile/tags/markProfileAsLoginError.js";


export default async function ensureFacebookAccountActive(
    adsPower,
    profile,
    page,
    options = {}
) {
    let accountLockDetected = false;
    const markLockedLoginError = async () => {
        try {
            const result = await markProfileAsLoginError(adsPower, profile);
            await options.onStep?.("account.lock.login_error", { added: result.added, alreadyMarked: result.alreadyMarked });
            console.log("Не вдалося відновити locked-акаунт. Профіль позначено Login Error.");
        } catch {
            console.error("Не вдалося додати тег Login Error до locked-профілю");
        }
    };
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
            accountLockDetected = true;
            const fixSucceeded = await fixAccountLock(page, { ...options, adsPower, profile });
            console.log(`Результат fixAccountLock: ${fixSucceeded}`);

            facebookState = await detectFacebookState(page);
            console.log(`Стан Facebook після fixAccountLock: ${facebookState}`);
            if (!fixSucceeded || facebookState !== "READY") {
                await markLockedLoginError();
                return false;
            }
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
        if (accountLockDetected) await markLockedLoginError();
        console.error(
            "Не вдалося перевірити активність Facebook-акаунта:",
            error.message
        );
        return false;
    }
}
