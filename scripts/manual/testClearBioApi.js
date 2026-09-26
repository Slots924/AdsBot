import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import getAboutSectionTokens
    from "../../facebook/api-actions/getAboutSectionTokens.js";
import updateBio from "../../facebook/api-actions/updateBio.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1867;
const actionTimeout = 30000;
const bioSection = "directory_intro";


// Виводить безпечну діагностику без токенів сесії та вмісту профілю.
function printResult(title, result) {
    console.log(`\n[BIO-CLEAR-TEST] ${title}`);
    console.dir({
        success: result?.success ?? false,
        status: result?.status ?? "UNKNOWN",
        httpStatus: result?.httpStatus ?? null,
        missingSections: result?.missingSections ?? null,
        error: result?.error ?? null,
        graphqlErrors: Array.isArray(result?.data?.errors)
            ? result.data.errors.map((item) => ({
                code: item?.code ?? null,
                message: item?.message ?? null,
            }))
            : null,
    }, { depth: null, colors: true });
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("РУЧНИЙ ТЕСТ ОЧИЩЕННЯ FACEBOOK BIO ЧЕРЕЗ API");
    console.log("=".repeat(72));

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) {
            throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);
        }
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
        printResult("Захоплення актуального Facebook payload", payloadResult);
        if (!payloadResult.success) {
            throw new Error(payloadResult.error ?? payloadResult.status);
        }

        const tokensResult = await getAboutSectionTokens({
            page,
            commonPayload: payloadResult.data,
            sections: [bioSection],
            timeout: actionTimeout,
        });
        printResult("Отримання токенів Bio", tokensResult);
        const bioTokens = tokensResult.data?.[bioSection];
        if (!bioTokens?.collectionToken || !bioTokens?.sectionToken) {
            throw new Error("Не отримано токени directory_intro; mutation не запускали");
        }

        const bioResult = await updateBio({
            page,
            commonPayload: payloadResult.data,
            collectionToken: bioTokens.collectionToken,
            sectionToken: bioTokens.sectionToken,
            value: "",
            timeout: actionTimeout,
        });
        printResult("Очищення Bio", bioResult);
        if (!bioResult.success) process.exitCode = 1;
    } catch (error) {
        process.exitCode = 1;
        console.error("\n[BIO-CLEAR-TEST] Помилка:");
        console.error(error.stack ?? error.message ?? error);
    } finally {
        browser?.disconnect();
        if (profileOpened) {
            console.log(`\n[BIO-CLEAR-TEST] Профіль ${profileNo} залишено відкритим для перевірки Bio.`);
        }
        console.log("=".repeat(72));
    }
}


main();
