import "dotenv/config";

import AdsPower from "./classes/AdsPower.js";
import checkProfileHealth from "./scenarios/checkProfileHealth.js";


// Номер профілю AdsPower, який потрібно перевірити
const profileNo = 123;


async function testCheckProfileHealth() {
    console.log("=== ТЕСТ ПЕРЕВІРКИ СТАНУ ПРОФІЛЮ ===");
    console.log(`Номер профілю: ${profileNo}`);

    try {
        console.log("\n1. Створюємо клієнт AdsPower...");
        const adsPower = new AdsPower();
        console.log("Клієнт AdsPower створено");

        console.log("\n2. Отримуємо інформацію про профіль...");
        const profile = await adsPower.getProfileByNo(profileNo);
        console.log("Інформацію про профіль отримано");
        console.log(`ID профілю: ${profile.profile_id}`);
        console.log(`Номер профілю: ${profile.profile_no}`);

        console.log("\n3. Передаємо профіль у checkProfileHealth()...");
        console.log("Перевіряємо BAN-тег і працездатність проксі...");
        const health = await checkProfileHealth(profile);
        console.log("Перевірку стану профілю завершено");

        console.log("\n4. Результат перевірки:");

        if (health === "READY") {
            console.log("READY — профіль готовий до роботи");
        } else if (health === "BANNED") {
            console.log("BANNED — профіль має тег BAN");
        } else if (health === "PROXY_FAILED") {
            console.log("PROXY_FAILED — проксі профілю не працює");
        } else {
            console.log(`Невідомий результат: ${health}`);
        }

        console.log("\n=== ТЕСТ УСПІШНО ЗАВЕРШЕНО ===");

    } catch (error) {
        console.error("\n=== ПОМИЛКА ПІД ЧАС ТЕСТУ ===");
        console.error(`Не вдалося перевірити профіль №${profileNo}`);
        console.error("Причина:", error.message);
        process.exitCode = 1;
    }
}


testCheckProfileHealth();
