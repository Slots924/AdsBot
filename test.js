import "dotenv/config";

import AdsPower from "./classes/AdsPower.js";

import normalizeProxy from "./services/proxy/normalizeProxy.js";
import checkProxy from "./services/proxy/checkProxy.js";

import hasBanTag from "./services/profile/hasBanTag.js";
import markProfileAsBanned from "./services/profile/markProfileAsBanned.js";


const adsPower = new AdsPower();

// Номер профілю для тесту
const profileNo = 123;


async function testProfile() {
    let profileOpened = false;

    try {
        console.log(`\nПеревіряємо профіль №${profileNo}`);

        // Отримуємо профіль
        const profile =
            await adsPower.getProfileByNo(profileNo);


        // Перевіряємо проксі профілю
        console.log("\n1. Перевірка проксі...");

        const proxy = normalizeProxy(
            profile.user_proxy_config
        );

        const proxyResult = await checkProxy(proxy);

        if (proxyResult.working) {
            console.log("Проксі працює");
            console.log("IP:", proxyResult.ip);
            console.log(
                "Час відповіді:",
                `${proxyResult.responseTime} мс`
            );
        } else {
            console.log("Проксі не працює");
            console.log("Помилка:", proxyResult.error);
        }


        // Перевіряємо тег BAN
        console.log("\n2. Перевірка тегу BAN...");

        const bannedBefore = hasBanTag(profile);

        if (bannedBefore) {
            console.log("Профіль уже має тег BAN");
        } else {
            console.log("Профіль не має тегу BAN");
        }


        // Додаємо тег BAN
        console.log("\n3. Додавання тегу BAN...");

        const banResult = await markProfileAsBanned(
            adsPower,
            profile
        );

        if (banResult.alreadyBanned) {
            console.log("Тег BAN уже був на профілі");
        }

        if (banResult.added) {
            console.log("Тег BAN успішно доданий");
        }


        // Повторно отримуємо профіль і перевіряємо тег
        const updatedProfile =
            await adsPower.getProfileByNo(profileNo);

        const bannedAfter =
            hasBanTag(updatedProfile);

        console.log(
            "BAN після оновлення:",
            bannedAfter
        );


        // Відкриваємо профіль
        console.log("\n4. Відкриття профілю...");

        const openResult =
            await adsPower.openProfile(profileNo);

        profileOpened = true;

        console.log("Профіль успішно відкритий");
        console.log("Дані відкриття:", openResult);


        // Закриваємо профіль
        console.log("\n5. Закриття профілю...");

        await adsPower.closeProfile(profileNo);

        profileOpened = false;

        console.log("Профіль успішно закритий");


        console.log("\nТЕСТ УСПІШНО ЗАВЕРШЕНИЙ");

    } catch (error) {
        console.error("\nПОМИЛКА ТЕСТУ:");
        console.error(error.message);

    } finally {
        /*
            Якщо після відкриття сталася помилка,
            намагаємося все одно закрити профіль.
        */
        if (profileOpened) {
            try {
                console.log(
                    "\nЗакриваємо профіль після помилки..."
                );

                await adsPower.closeProfile(profileNo);

                console.log("Профіль закритий");

            } catch (closeError) {
                console.error(
                    "Не вдалося закрити профіль:",
                    closeError.message
                );
            }
        }
    }
}


testProfile();