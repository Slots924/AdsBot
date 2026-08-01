// Завантажуємо змінні з .env
import "dotenv/config";

// Вбудована функція Node.js для запису файлів
import { writeFile } from "node:fs/promises";

// Підключаємо наш клас AdsPower
import AdsPower from "./classes/AdsPower.js";


// Створюємо об'єкт AdsPower
const adsPower = new AdsPower();


// Тут вказуємо номер профілю для тесту
const profileNo = 123;


// Красиво виводить заголовок у консоль
function printTitle(title) {
    console.log("\n========================================");
    console.log(title);
    console.log("========================================");
}


// Рекурсивно шукає цікаві назви полів
function findInterestingFields(data, currentPath = "") {
    const results = [];

    // Якщо значення не є об'єктом, далі шукати нічого
    if (data === null || typeof data !== "object") {
        return results;
    }

    for (const [key, value] of Object.entries(data)) {
        // Повний шлях до поля
        const fieldPath = currentPath
            ? `${currentPath}.${key}`
            : key;

        const lowerKey = key.toLowerCase();

        // Шукаємо поля, які можуть стосуватися тегів або груп
        const interestingWords = [
            "tag",
            "label",
            "group",
            "folder",
            "remark",
            "category",
        ];

        const isInteresting = interestingWords.some((word) =>
            lowerKey.includes(word)
        );

        if (isInteresting) {
            results.push({
                path: fieldPath,
                value,
            });
        }

        // Якщо всередині ще один об'єкт або масив,
        // продовжуємо пошук
        if (value !== null && typeof value === "object") {
            results.push(
                ...findInterestingFields(value, fieldPath)
            );
        }
    }

    return results;
}


async function runTest() {
    try {
        console.log(`Отримуємо профіль №${profileNo}...`);

        // Отримуємо весь профіль через AdsPower API
        const profile =
            await adsPower.getProfileByNo(profileNo);


        /*
            1. ВИВОДИМО КОРОТКУ ІНФОРМАЦІЮ
        */

        printTitle("КОРОТКА ІНФОРМАЦІЯ");

        console.log("Номер профілю:", profile.profile_no);
        console.log("ID профілю:", profile.profile_id);
        console.log("Назва:", profile.name);
        console.log("Група:", profile.group_name);
        console.log("ID групи:", profile.group_id);
        console.log("Платформа:", profile.platform);
        console.log("Логін:", profile.username);


        /*
            2. ПОКАЗУЄМО НАЗВИ ВСІХ ПОЛІВ
        */

        printTitle("ПОЛЯ ВЕРХНЬОГО РІВНЯ");

        console.log(Object.keys(profile).sort());


        /*
            3. ВИВОДИМО ПОВНИЙ ОБ'ЄКТ

            depth: null означає показати всі вкладені об'єкти.
            colors: true додає кольори в консоль.
            sorted: true сортує поля за назвою.
        */

        printTitle("ПОВНИЙ ОБ'ЄКТ ПРОФІЛЮ");

        console.dir(profile, {
            depth: null,
            colors: true,
            sorted: true,
        });


        /*
            4. ШУКАЄМО ПОЛЯ, ЯКІ МОЖУТЬ
               СТОСУВАТИСЯ ТЕГІВ
        */

        const interestingFields =
            findInterestingFields(profile);

        printTitle("МОЖЛИВІ ПОЛЯ ТЕГІВ І ГРУП");

        if (interestingFields.length === 0) {
            console.log(
                "Поля tag, label, group, folder або remark не знайдені"
            );
        } else {
            for (const field of interestingFields) {
                console.log(`\nПоле: ${field.path}`);

                console.dir(field.value, {
                    depth: null,
                    colors: true,
                });
            }
        }


        /*
            5. ЗБЕРІГАЄМО ПОВНУ ВІДПОВІДЬ У JSON

            Так її буде зручніше переглядати у VS Code.
        */

        const fileName = "profile-debug.json";

        await writeFile(
            fileName,
            JSON.stringify(profile, null, 4),
            "utf8"
        );

        printTitle("ГОТОВО");

        console.log(
            `Повну інформацію збережено у файл: ${fileName}`
        );

        console.log(
            "Увага: файл може містити паролі, cookies та дані проксі."
        );

    } catch (error) {
        console.error("\nПомилка тесту:");
        console.error(error.message);
    }
}


// Запускаємо тест
runTest();