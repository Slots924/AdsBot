import dismissAutomatedBehavior from "../../facebook/actions/dismissAutomatedBehavior.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import isAutomatedBehavior from "../../facebook/state/checks/isAutomatedBehavior.js";


export default async function ensureFacebookAccountReady(page) {
    console.log("Перевіряємо, чи Facebook-акаунт готовий до роботи...");

    try {
        const facebookState = await detectFacebookState(page);
        console.log(`Поточний стан Facebook: ${facebookState}`);

        if (facebookState !== "AUTOMATED_BEHAVIOR") {
            return facebookState;
        }

        console.log(
            "Виявлено automated behavior. Викликаємо Dismiss..."
        );
        const dismissSucceeded = await dismissAutomatedBehavior(page);
        console.log(
            `Результат dismissAutomatedBehavior: ${dismissSucceeded}`
        );

        console.log(
            "Перевіряємо, чи зникло automated behavior..."
        );
        const automatedBehaviorStillPresent =
            await isAutomatedBehavior(page);

        if (automatedBehaviorStillPresent) {
            console.error(
                "Automated behavior досі залишається після Dismiss"
            );
            return "AUTOMATED_BEHAVIOR";
        }

        console.log(
            "Automated behavior зникло. Повторно визначаємо стан Facebook..."
        );
        const stateAfterDismiss = await detectFacebookState(page);
        console.log(
            `Стан Facebook після Dismiss: ${stateAfterDismiss}`
        );

        return stateAfterDismiss;

    } catch (error) {
        console.error(
            "Не вдалося перевірити готовність Facebook-акаунта:",
            error.message
        );
        return "ERROR";
    }
}
