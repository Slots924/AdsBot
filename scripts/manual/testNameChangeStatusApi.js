import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import getNameChangeStatus
    from "../../facebook/api-actions/accounts/getNameChangeStatus.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1864;
const actionTimeout = 30000;
const accountsCenterUrl = "https://accountscenter.facebook.com/";
const accountsCenterGraphqlUrl = "https://accountscenter.facebook.com/api/graphql/";


// Друкує помилку без session-параметрів Facebook та Accounts Center.
function logActionError(actionName, result) {
    console.error(`\n[NAME-STATUS-TEST] Помилка ${actionName}:`);
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
    console.log("РУЧНИЙ ТЕСТ ПЕРЕВІРКИ МОЖЛИВОСТІ ЗМІНИ ІМЕНІ FACEBOOK");
    console.log("=".repeat(72));

    try {
        console.log(`[NAME-STATUS-TEST] Отримуємо AdsPower-профіль ${profileNo}`);
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

        console.log("[NAME-STATUS-TEST] Захоплюємо актуальний Accounts Center GraphQL request");
        const payloadResult = await captureGraphqlPayload(page, {
            profileUrl: accountsCenterUrl,
            graphqlUrl: accountsCenterGraphqlUrl,
            timeout: actionTimeout,
        });
        console.log(`[NAME-STATUS-TEST] captureGraphqlPayload: ${payloadResult.status}`);
        if (!payloadResult.success) {
            logActionError("captureGraphqlPayload", payloadResult);
            throw new Error(payloadResult.error ?? payloadResult.status);
        }

        console.log("[NAME-STATUS-TEST] Перевіряємо правила зміни імені");
        const result = await getNameChangeStatus({
            page,
            commonPayload: payloadResult.data,
            timeout: actionTimeout,
        });
        console.log(`[NAME-STATUS-TEST] getNameChangeStatus: ${result.status}`);
        if (!result.success) {
            logActionError("getNameChangeStatus", result);
            throw new Error(result.status);
        }

        console.log({
            can_change_name: result.data.canChangeName,
            cooldown_status: result.data.cooldownStatus,
            can_revert_name: result.data.canRevertName,
        });
    } catch (error) {
        console.error("\n[NAME-STATUS-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            console.log(`[NAME-STATUS-TEST] AdsPower-профіль ${profileNo} залишено відкритим для перевірки.`);
        }
        console.log("=".repeat(72));
    }
}


main();
