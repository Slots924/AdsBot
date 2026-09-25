import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import changeProfilePicture
    from "../../facebook/api-actions/profile/changeProfilePicture.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;
const imagePath = "C:\\Users\\Darkness\\Downloads\\56277074_011_5bd0.jpg";


// Друкує деталі помилки, що виникла до або під час зміни аватарки.
function logAvatarError(actionName, result) {
    console.error(`\n[AVATAR-TEST] Помилка ${actionName}:`);
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
    console.log("РУЧНИЙ ТЕСТ FACEBOOK PROFILE PICTURE API");
    console.log("=".repeat(72));

    try {
        console.log(`[AVATAR-TEST] Отримуємо AdsPower-профіль ${profileNo}`);
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

        const payloadResult = await captureGraphqlPayload(page, {
            timeout: actionTimeout,
        });
        console.log(`[AVATAR-TEST] captureGraphqlPayload: ${payloadResult.status}`);
        if (!payloadResult.success) {
            logAvatarError("captureGraphqlPayload", payloadResult);
            throw new Error(payloadResult.error ?? payloadResult.status);
        }

        console.log("[AVATAR-TEST] Запускаємо зміну аватарки", { imagePath });
        const result = await changeProfilePicture({
            page,
            commonPayload: payloadResult.data,
            imagePath,
            timeout: actionTimeout,
        });
        console.log(`[AVATAR-TEST] changeProfilePicture: ${result.status}`);
        console.dir(result.data, { depth: null, colors: true });
        if (!result.success) {
            logAvatarError("changeProfilePicture", result);
            process.exitCode = 1;
        }
    } catch (error) {
        console.error("\n[AVATAR-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            console.log(`[AVATAR-TEST] AdsPower-профіль ${profileNo} залишено відкритим для перевірки.`);
        }
        console.log("=".repeat(72));
    }
}


main();
