import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../classes/AdsPower.js";
import openPageWithoutPopups from "../facebook/actions/openPageWithoutPopups.js";
import isPostAvailable from "../facebook/post/checks/isPostAvailable.js";
import commentOnPost from "../facebook/workflows/commentOnPost.js";
import ensureAdsPowerProfileReady from "../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountLoggedIn from "../workflows/profile/ensureFacebookAccountLoggedIn.js";


const profileNo = 1418;
const postUrl = "https://www.facebook.com/share/p/1Br6k96dhi/";

const comments = [
    "Great post, thanks for sharing.",
    "This was interesting to read.",
    "Thanks for sharing this update.",
    "I appreciate you posting this.",
    "This is a thoughtful perspective.",
    "Nice to see this shared here.",
    "This is useful information.",
    "I enjoyed reading this post.",
    "Thanks for bringing this up.",
    "This is worth thinking about.",
    "I appreciate the insight.",
    "This was clearly explained.",
    "Good to know, thanks for sharing.",
    "This is an interesting point.",
    "I found this helpful.",
    "Thanks for the useful update.",
    "This is a valuable perspective.",
    "Glad I came across this post.",
    "This gave me something to consider.",
    "I appreciate the context here.",
];


function getRandomComment() {
    const randomIndex = Math.floor(
        Math.random() * comments.length
    );

    return comments[randomIndex];
}


async function testCommentOnPost() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpenedByTest = false;

    console.log("=== Початок тесту commentOnPost ===");
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
                "Facebook-акаунт не готовий до роботи"
            );
        }

        console.log("Крок 8. Перевіряємо доступність поста...");
        const postAvailable = await isPostAvailable(page);

        if (!postAvailable) {
            throw new Error("Facebook-пост недоступний");
        }

        console.log("Facebook-пост доступний");

        console.log("Крок 9. Вибираємо випадковий коментар...");
        const selectedComment = getRandomComment();
        console.log(`Вибраний коментар: ${selectedComment}`);

        console.log("Крок 10. Запускаємо workflow commentOnPost...");
        const commentPublished = await commentOnPost(
            page,
            selectedComment
        );
        console.log(`Результат commentOnPost: ${commentPublished}`);

        if (!commentPublished) {
            throw new Error("Не вдалося опублікувати коментар");
        }

        console.log("Коментар успішно опубліковано");
    } catch (error) {
        console.error("Помилка тесту commentOnPost:");
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

        console.log("=== Завершення тесту commentOnPost ===");
    }
}


testCommentOnPost();
