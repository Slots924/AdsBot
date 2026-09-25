import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import changeFacebookNameWorkflow
    from "../../facebook/api-workflows/accounts/changeFacebookName.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1864;
const actionTimeout = 30000;
const requestedName = {
    firstName: "Bálint",
    middleName: "",
    lastName: "Kovács",
};


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("РУЧНИЙ ТЕСТ API WORKFLOW ЗМІНИ FACEBOOK ІМЕНІ");
    console.log("=".repeat(72));

    try {
        console.log(`[NAME-WORKFLOW-TEST] Отримуємо AdsPower-профіль ${profileNo}`);
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

        console.log("[NAME-WORKFLOW-TEST] Запускаємо workflow зміни імені", requestedName);
        const result = await changeFacebookNameWorkflow({
            page,
            ...requestedName,
            timeout: actionTimeout,
        });

        console.log(`[NAME-WORKFLOW-TEST] changeFacebookNameWorkflow: ${result.status}`);
        console.dir(result, {
            depth: null,
            colors: true,
        });

        if (!result.success) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error("\n[NAME-WORKFLOW-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            console.log(`[NAME-WORKFLOW-TEST] AdsPower-профіль ${profileNo} залишено відкритим для перевірки.`);
        }
        console.log("=".repeat(72));
    }
}


main();
