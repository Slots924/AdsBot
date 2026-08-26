// РУЧНИЙ ТЕСТ — НЕ ЗАПУСКАТИ АВТОМАТИЧНО!
// Цей файл тільки для ручної перевірки генерації даних профілів.
//
// Як запустити з консолі:
//   node scripts/manual/test-us-comment-profiles.js
//
// ВАЖЛИВО: у папці проєкту повинен бути .env з XAI_API_KEY (як в інших manual-скриптах).
//
// Скрипт:
// - просить 1 чоловічого + 1 жіночого профілю для geo=UK
// - якщо даних для UK ще немає — автоматично згенерує через Grok (імена 200, компанії 50, універи 50, професії переклад)
// - виводить красиво відформатований результат у консоль
// - після роботи дані збережуться у data/generated-profiles-data/ з ротацією

import "dotenv/config";
import CommentAccountProfileData from "../../services/profiles/CommentAccountProfileData.js";

async function runManualTest() {
    console.log("=== РУЧНИЙ ТЕСТ ДАНИХ ПРОФІЛІВ ДЛЯ КОМЕНТАРНИХ АКАУНТІВ ===");
    console.log("Гео: UK");
    console.log("Запитуємо: 1 чоловічий + 1 жіночий");
    console.log("-----------------------------------------------------------\n");

    const provider = new CommentAccountProfileData();

    try {
        const result = await provider.getCommentAccountProfiles({
            geo: "UK",
            maleCount: 1,
            femaleCount: 1,
        });

        console.log(`Гео: ${result.geo}`);
        console.log(`Всього профілів: ${result.profiles.length}\n`);

        const males = result.profiles.filter((p) => p.gender === "male");
        const females = result.profiles.filter((p) => p.gender === "female");

        console.log("═══════════════════════════════════════════════════════════");
        console.log("          ВЗЯТІ ПРОФІЛІ (саме ці 1+1 були використані)");
        console.log("═══════════════════════════════════════════════════════════\n");

        console.log("ЧОЛОВІЧІ ПРОФІЛІ (1):");
        males.forEach((p, index) => {
            console.log(`  ${index + 1}. ${p.firstName} ${p.lastName}`);
            console.log(`     Стать:       ${p.gender}`);
            console.log(`     Компанія:    ${p.company}`);
            console.log(`     Професія:    ${p.profession}`);
            console.log(`     Університет: ${p.university}`);
            console.log("");
        });

        console.log("ЖІНОЧІ ПРОФІЛІ (1):");
        females.forEach((p, index) => {
            console.log(`  ${index + 1}. ${p.firstName} ${p.lastName}`);
            console.log(`     Стать:       ${p.gender}`);
            console.log(`     Компанія:    ${p.company}`);
            console.log(`     Професія:    ${p.profession}`);
            console.log(`     Університет: ${p.university}`);
            console.log("");
        });

        console.log("═══════════════════════════════════════════════════════════");
        console.log("ПОВНИЙ JSON ДЛЯ ПЕРЕВІРКИ:");
        console.log(JSON.stringify(result.profiles, null, 2));
        console.log("═══════════════════════════════════════════════════════════\n");

        console.log("-----------------------------------------------------------");
        console.log("Тест завершено успішно. Дані збережено з ротацією.");
        console.log("Наступний запуск візьме наступні записи зі списків.");
    } catch (error) {
        console.error("ПОМИЛКА під час виконання тесту:");
        console.error(error);
        if (error.code) {
            console.error(`Код помилки: ${error.code}`);
        }
        process.exitCode = 1;
    }
}

runManualTest();
