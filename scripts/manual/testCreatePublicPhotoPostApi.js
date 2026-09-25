import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import createPublicPhotoPost
    from "../../facebook/api-actions/posts/createPublicPhotoPost.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;
const imagePath = "C:\\Users\\Darkness\\Downloads\\56277074_011_5bd0.jpg";


// Друкує деталі помилки без session-параметрів і токенів Facebook.
function logPostError(actionName, result) {
    console.error(`\n[PUBLIC-POST-TEST] Помилка ${actionName}:`);
    console.dir(result?.data?.errors ?? result, {
        depth: null,
        colors: true,
    });
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("РУЧНИЙ ТЕСТ FACEBOOK PUBLIC PHOTO POST API");
    console.log("=".repeat(72));

    try {
        console.log(`[PUBLIC-POST-TEST] Отримуємо AdsPower-профіль ${profileNo}`);
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);
        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        const page = (await browser.pages())[0] ?? await browser.newPage();

        console.log("[PUBLIC-POST-TEST] Отримуємо актуальні параметри Facebook-сесії");
        const payloadResult = await captureGraphqlPayload(page, {
            timeout: actionTimeout,
        });
        console.log(`[PUBLIC-POST-TEST] captureGraphqlPayload: ${payloadResult.status}`);
        if (!payloadResult.success) {
            logPostError("captureGraphqlPayload", payloadResult);
            throw new Error(payloadResult.error ?? payloadResult.status);
        }

        console.log("[PUBLIC-POST-TEST] Завантажуємо фото та створюємо PUBLIC-пост", {
            imagePath,
        });
        const result = await createPublicPhotoPost({
            page,
            commonPayload: payloadResult.data,
            imagePath,
            timeout: actionTimeout,
        });
        console.log(`[PUBLIC-POST-TEST] createPublicPhotoPost: ${result.status}`);
        console.dir(result.data, { depth: null, colors: true });
        if (!result.success) {
            logPostError("createPublicPhotoPost", result);
            process.exitCode = 1;
        }
    } catch (error) {
        console.error("\n[PUBLIC-POST-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            console.log(`[PUBLIC-POST-TEST] AdsPower-профіль ${profileNo} залишено відкритим для перевірки.`);
        }
        console.log("=".repeat(72));
    }
}


main();
