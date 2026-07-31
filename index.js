// Завантажує змінні з файлу .env
import "dotenv/config";

// Підключаємо наш клас AdsPower
import AdsPower from "./classes/AdsPower.js";

// Вбудований модуль Node.js для роботи з консоллю
import readline from "node:readline/promises";

// Підключаємо введення і виведення консолі
import {
    stdin as input,
    stdout as output,
} from "node:process";


// Створюємо об'єкт для роботи з AdsPower
const adsPower = new AdsPower();


// Створюємо інтерфейс для читання тексту з консолі
const consoleInput = readline.createInterface({
    input,
    output,
});


// Тут вручну задаємо номер профілю для тесту
const profileNo = 123;


async function main() {
    try {
        // Відкриваємо профіль
        const browserData = await adsPower.openProfile(profileNo);

        console.log(`Профіль ${profileNo} успішно відкрито`);

        // Виводимо адресу для майбутнього підключення Puppeteer
        console.log(
            "Puppeteer WebSocket:",
            browserData.ws.puppeteer
        );


        // Код зупиниться тут і чекатиме натискання Enter
        await consoleInput.question(
            "\nНатисни Enter, щоб закрити профіль..."
        );


        // Після натискання Enter закриваємо профіль
        const closeResult = await adsPower.closeProfile(profileNo);

        console.log(`Профіль ${profileNo} успішно закрито`);

        // Для тесту виводимо відповідь AdsPower
        console.log("Відповідь AdsPower:", closeResult);

    } catch (error) {
        console.error("Помилка:", error.message);

    } finally {
        // Закриваємо інтерфейс читання консолі
        consoleInput.close();
    }
}


// Запускаємо головну функцію
main();