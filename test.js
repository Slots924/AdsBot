import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "./classes/AdsPower.js";
import openPageWithoutPopups from "./facebook/openPageWithoutPopups.js";
import ensureLogin from "./facebook/state/ensureLogin.js";


// Номер профілю AdsPower для ручної перевірки
const profileNo = 1466;
const facebookUrl = "https://www.facebook.com/";


async function testEnsureLogin() {
    const adsPower = new AdsPower();
    let browser;

    try {
        const browserData = await adsPower.openProfile(profileNo);

        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();

        await openPageWithoutPopups(page, facebookUrl);

        const isLoggedIn = await ensureLogin(page);

        console.log(
            isLoggedIn
                ? "Вхід у Facebook забезпечено"
                : "Не вдалося забезпечити вхід у Facebook"
        );
    } catch (error) {
        console.error(
            `Помилка перевірки входу у профілі ${profileNo}:`,
            error.message
        );
    } finally {
        browser?.disconnect();
    }
}


testEnsureLogin();
