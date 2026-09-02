import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import openFacebookPostViaAuthorPage
    from "../../facebook/actions/openFacebookPostViaAuthorPage.js";
import setRandomPostReaction
    from "../../facebook/actions/setRandomPostReaction.js";


const profileNo = 1789;
const postUrl = "https://www.facebook.com/permalink.php?story_fbid=pfbid08fss2D1EcEbiJm2a5sVUTdwMhcnQ41aJ4iePsnJ7xgRUARXZZrx2cnvMs6rkj9qUl&id=61592141946590";


async function run() {
    const adsPower = new AdsPower();
    let browser;

    try {
        console.log(`Відкриваємо AdsPower-профіль ${profileNo}`);
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        const result = await openFacebookPostViaAuthorPage(page, {
            postUrl,
            timeout: 15000,
            logger: console,
        });

        console.log("Результат ручної перевірки:");
        console.dir(result, { depth: null });

        if (result.success) {
            console.log("Сторінка поста відкрита, ставимо випадкову реакцію");
            const reactionSet = await setRandomPostReaction(page);
            console.log(`Результат випадкової реакції: ${reactionSet}`);
        }
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
