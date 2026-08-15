import checkProfileHealth from "../../services/profile/checkProfileHealth.js";


export default async function ensureAdsPowerProfileReady(
    adsPower,
    profile
) {
    const profileNo = profile?.profile_no ?? "невідомий";

    console.log(
        `Перевіряємо готовність AdsPower-профілю ${profileNo}...`
    );

    try {
        const profileHealth = await checkProfileHealth(
            adsPower,
            profile
        );

        console.log(
            `Результат перевірки AdsPower-профілю ${profileNo}: ${profileHealth}`
        );

        switch (profileHealth) {
            case "READY":
                console.log(
                    `AdsPower-профіль ${profileNo} готовий до відкриття`
                );
                return true;

            case "BANNED":
                console.error(
                    `Facebook-акаунт профілю ${profileNo} забанено`
                );
                return false;

            case "LOGIN_ERROR":
                console.error(
                    `Профіль ${profileNo} має помилку входу у Facebook`
                );
                return false;

            case "PROXY_FAILED":
                console.error(
                    `У профілю ${profileNo} проблеми з проксі`
                );
                return false;

            case "ALREADY_OPEN":
                console.error(
                    `AdsPower-профіль ${profileNo} уже відкритий`
                );
                return false;

            default:
                console.error(
                    `Профіль ${profileNo} має невідомий статус: ${profileHealth}`
                );
                return false;
        }
    } catch (error) {
        console.error(
            `Не вдалося перевірити готовність AdsPower-профілю ${profileNo}:`,
            error.message
        );
        return false;
    }
}
