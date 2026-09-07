import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import { facebookLanguageSelector } from "../../facebook/selectors/language.js";


const positionalArguments = process.argv.slice(2)
    .filter((argument) => !argument.startsWith("--"));
const profileNo = Number(positionalArguments[0]);

if (!Number.isInteger(profileNo) || profileNo <= 0) {
    throw new Error(
        "Використання: node scripts/manual/ensureEnglish.js <номер профілю>"
    );
}


async function readFacebookLanguage(page) {
    try {
        return await page.$eval(
            facebookLanguageSelector,
            (element) => element.getAttribute("lang")
        );
    } catch (error) {
        return {
            error: error.message,
            url: page.url(),
        };
    }
}


async function run() {
    const adsPower = new AdsPower();
    let browser;

    try {
        console.log(`Відкриваємо AdsPower-профіль ${profileNo} у видимому вікні`);
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        const windowResult = await configureFacebookAutomationWindow(page, {
            browserMode: "visible",
        });
        console.log("Розмір вікна:", windowResult);

        console.log("Мова до ensureEnglish:", await readFacebookLanguage(page));
        console.log("Запускаємо ensureEnglish...");
        await ensureEnglish(page);

        const languageAfter = await readFacebookLanguage(page);
        console.log("Мова після ensureEnglish:", languageAfter);
        console.log("Поточний URL:", page.url());

        if (languageAfter === "en") {
            console.log("Мова Facebook: англійська");
            return;
        }

        console.error("Мова Facebook не стала en");
        process.exitCode = 1;
    } catch (error) {
        console.error("Ручна перевірка завершилася помилкою:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        await browser?.disconnect();
        console.log(`Профіль ${profileNo} залишено відкритим для перевірки`);
    }
}


run();
