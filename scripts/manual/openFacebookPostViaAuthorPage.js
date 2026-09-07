import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openFacebookPostViaAuthorPage
    from "../../facebook/actions/openFacebookPostViaAuthorPage.js";


const positionalArguments = process.argv.slice(2)
    .filter((argument) => !argument.startsWith("--"));
const profileNo = Number(positionalArguments[0]);
const postUrl = String(positionalArguments[1] ?? "").trim();

if (!Number.isInteger(profileNo) || profileNo <= 0 || !postUrl) {
    throw new Error(
        "Використання: node scripts/manual/openFacebookPostViaAuthorPage.js "
        + "<номер профілю> <посилання на пост>"
    );
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
        const result = await openFacebookPostViaAuthorPage(page, {
            postUrl,
            timeout: 15000,
            logger: console,
        });

        console.log("Результат ручної перевірки:");
        console.dir(result, { depth: null });
        if (result.success) {
            console.log("Пост відкрито");
            return;
        }

        console.error("Пост не відкрито");
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
