import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "./classes/AdsPower.js";
import ensureEnglish from "./facebook/ensureEnglish.js";


// Номер профілю AdsPower для ручної перевірки
const profileNo = 1468;


async function testEnsureEnglish() {
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

        console.log("Перевірку мови завершено");
        console.log("Профіль залишено відкритим");
    } catch (error) {
        console.error("Помилка тесту:", error.message);
        process.exitCode = 1;
    } finally {
        browser?.disconnect();
    }
}


testEnsureEnglish();
