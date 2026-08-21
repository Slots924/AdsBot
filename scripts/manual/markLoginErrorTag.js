import "dotenv/config";

import AdsPower from "../../classes/AdsPower.js";
import hasLoginErrorTag from "../../services/profile/tags/hasLoginErrorTag.js";
import markProfileAsLoginError from "../../services/profile/tags/markProfileAsLoginError.js";


// Номер профілю AdsPower для ручної перевірки
const profileNo = 1466;


function logProfileTags(profile) {
    const tags = Array.isArray(profile?.profile_tags)
        ? profile.profile_tags
        : [];

    if (tags.length === 0) {
        console.log("Теги: відсутні");
        return;
    }

    console.log(`Кількість тегів: ${tags.length}`);

    tags.forEach((tag, index) => {
        console.log(
            `Тег ${index + 1}: ${tag.name} | ID: ${tag.id} | Колір: ${tag.color}`
        );
    });
}


async function testLoginErrorTag() {
    const adsPower = new AdsPower();

    console.log("=== Початок перевірки тегу Login Error ===");
    console.log(`Номер профілю: ${profileNo}`);

    try {
        console.log("Отримуємо профіль з AdsPower...");
        let profile = await adsPower.getProfileByNo(profileNo);
        console.log("Профіль успішно отримано");

        console.log("Поточні теги профілю:");
        logProfileTags(profile);

        const hadLoginErrorTag = hasLoginErrorTag(profile);
        console.log(
            `Тег Login Error до перевірки: ${hadLoginErrorTag ? "є" : "немає"}`
        );

        if (hadLoginErrorTag) {
            console.log(
                "Тег Login Error уже встановлений. Оновлення не потрібне"
            );
        } else {
            console.log("Додаємо тег Login Error...");

            const result = await markProfileAsLoginError(
                adsPower,
                profile
            );

            console.log("Результат додавання тегу:", result);
            console.log("Повторно отримуємо профіль для перевірки...");

            profile = await adsPower.getProfileByNo(profileNo);
            console.log("Профіль повторно отримано");
        }

        const hasTagAfterCheck = hasLoginErrorTag(profile);

        console.log("Підсумкові теги профілю:");
        logProfileTags(profile);
        console.log(
            `Тег Login Error після перевірки: ${hasTagAfterCheck ? "є" : "немає"}`
        );

        if (!hasTagAfterCheck) {
            throw new Error(
                "Тег Login Error не знайдено після спроби додавання"
            );
        }

        console.log("Перевірку успішно завершено");
    } catch (error) {
        console.error("Помилка перевірки тегу Login Error:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        console.log("=== Завершення перевірки тегу Login Error ===");
    }
}


testLoginErrorTag();
