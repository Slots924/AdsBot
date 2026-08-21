import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import sortCommentsByNewest from "../../facebook/actions/sortCommentsByNewest.js";
import isPostAvailable from "../../facebook/post/checks/isPostAvailable.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const profileNo = 1418;
const postUrl = "https://www.facebook.com/share/p/1Br6k96dhi/";


async function testSortCommentsByNewest() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpenedByTest = false;

    console.log("=== Початок тесту sortCommentsByNewest ===");
    console.log(`Профіль AdsPower: ${profileNo}`);
    console.log(`Посилання на пост: ${postUrl || "не вказано"}`);

    try {
        if (!postUrl.trim()) {
            throw new Error(
                "Вкажіть посилання на Facebook-пост у змінній postUrl"
            );
        }

        console.log("Крок 1. Отримуємо інформацію про профіль...");
        const profile = await adsPower.getProfileByNo(profileNo);
        console.log("Профіль успішно отримано");

        console.log("Крок 2. Перевіряємо готовність AdsPower-профілю...");
        const adsPowerProfileReady =
            await ensureAdsPowerProfileReady(adsPower, profile);

        if (!adsPowerProfileReady) {
            throw new Error(
                "AdsPower-профіль не готовий до відкриття"
            );
        }

        console.log("Крок 3. Відкриваємо AdsPower-профіль...");
        const browserData = await adsPower.openProfile(profileNo);
        profileOpenedByTest = true;
        console.log("AdsPower-профіль успішно відкрито");

        console.log("Крок 4. Підключаємо Puppeteer...");
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        console.log("Puppeteer успішно підключено");

        console.log("Крок 5. Отримуємо сторінку браузера...");
        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        console.log(`Поточний URL: ${page.url()}`);

        console.log("Крок 6. Відкриваємо Facebook-пост...");
        await openPageWithoutPopups(page, postUrl);
        console.log(`Сторінку відкрито. Поточний URL: ${page.url()}`);

        console.log("Крок 7. Перевіряємо вхід у Facebook...");
        const facebookAccountLoggedIn =
            await ensureFacebookAccountLoggedIn(
                adsPower,
                profile,
                page
            );

        if (!facebookAccountLoggedIn) {
            throw new Error(
                "Не вдалося підтвердити вхід у Facebook"
            );
        }

        console.log("Крок 8. Перевіряємо активність Facebook-акаунта...");
        const facebookAccountActive =
            await ensureFacebookAccountActive(
                adsPower,
                profile,
                page
            );

        if (!facebookAccountActive) {
            throw new Error("Facebook-акаунт не активний");
        }

        console.log("Крок 9. Перевіряємо доступність поста...");
        const postAvailable = await isPostAvailable(page);

        if (!postAvailable) {
            throw new Error("Facebook-пост недоступний");
        }

        console.log("Facebook-пост доступний");
        console.log(
            "Крок 10. Запускаємо action sortCommentsByNewest..."
        );

        const commentsSorted = await sortCommentsByNewest(page);
        console.log(
            `Результат sortCommentsByNewest: ${commentsSorted}`
        );

        if (!commentsSorted) {
            throw new Error(
                "Не вдалося відсортувати коментарі за найновішими"
            );
        }

        console.log("Коментарі успішно відсортовано за найновішими");
    } catch (error) {
        console.error("Помилка тесту sortCommentsByNewest:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        if (browser) {
            console.log("Відключаємо Puppeteer від браузера...");
            browser.disconnect();
            console.log(
                "Puppeteer відключено, браузер залишається відкритим"
            );
        }

        if (profileOpenedByTest) {
            console.log(
                `Профіль ${profileNo} залишено відкритим для подальшої відладки`
            );
        } else {
            console.log("Тест не відкривав AdsPower-профіль");
        }

        console.log("=== Завершення тесту sortCommentsByNewest ===");
    }
}


testSortCommentsByNewest();
