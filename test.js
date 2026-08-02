import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "./classes/AdsPower.js";
import ensureEnglish from "./facebook/ensureEnglish.js";
import scrollToPostLikeButton from "./facebook/scrollToPostLikeButton.js";


// Номер профілю AdsPower для ручної перевірки
const profileNo = 1468;

// Посилання на Facebook-пост для ручної перевірки
const postUrl = "https://www.facebook.com/mykhailofedorov.com.ua/posts/pfbid0K7kwRCgqcwEU8SvK2BvyM3pHeTWyHpS5xkVTV7xrPymy4Nk7iEQmco4EDeFegPEDl";


async function testScrollToPostLikeButton() {
    const adsPower = new AdsPower();
    let browser;

    try {
        const browserData =
            await adsPower.openProfile(profileNo);

        console.log(`Профіль ${profileNo} відкрито`);

        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();

        await ensureEnglish(page);

        await page.goto(postUrl, {
            waitUntil: "domcontentloaded",
        });

        await scrollToPostLikeButton(page);

        console.log("Перевірку прокручування завершено");
        console.log("Профіль залишено відкритим");
    } catch (error) {
        console.error("Помилка тесту:", error.message);
        process.exitCode = 1;
    } finally {
        browser?.disconnect();
    }
}


testScrollToPostLikeButton();
