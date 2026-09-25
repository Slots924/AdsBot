import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;
const facebookUrl = "https://www.facebook.com/me";
const facebookGraphqlUrl = "https://www.facebook.com/api/graphql/";
const accountsCenterUrl = "https://accountscenter.facebook.com/";
const accountsCenterGraphqlUrl = "https://accountscenter.facebook.com/api/graphql/";
const comparedFields = [
    "av",
    "__user",
    "__a",
    "fb_dtsg",
    "jazoest",
    "lsd",
    "__comet_req",
    "__spin_r",
    "__spin_b",
    "__spin_t",
    "__crn",
    "__req",
];


// Порівнює лише наявність і рівність значень, не виводячи session-токени в консоль.
function buildComparisonReport(facebookPayload, accountsCenterPayload) {
    return comparedFields.map((field) => {
        const facebookValue = facebookPayload?.[field];
        const accountsCenterValue = accountsCenterPayload?.[field];
        const facebookPresent = facebookValue !== undefined && facebookValue !== null;
        const accountsCenterPresent = accountsCenterValue !== undefined
            && accountsCenterValue !== null;
        const isSame = facebookPresent
            && accountsCenterPresent
            && String(facebookValue) === String(accountsCenterValue);

        return {
            field,
            facebook: facebookPresent ? "є" : "відсутнє",
            accountsCenter: accountsCenterPresent ? "є" : "відсутнє",
            comparison: isSame
                ? "однакове"
                : (facebookPresent && accountsCenterPresent ? "різне" : "немає для порівняння"),
        };
    });
}


function logCaptureError(sourceName, result) {
    console.error(`\n[SESSION-COMPARE-TEST] Не вдалося захопити ${sourceName} request:`);
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
    console.log("РУЧНИЙ ТЕСТ ПОРІВНЯННЯ FACEBOOK ТА ACCOUNTS CENTER SESSION-ПАРАМЕТРІВ");
    console.log("=".repeat(72));

    try {
        console.log(`[SESSION-COMPARE-TEST] Отримуємо AdsPower-профіль ${profileNo}`);
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

        console.log("[SESSION-COMPARE-TEST] Захоплюємо Facebook GraphQL request");
        const facebookResult = await captureGraphqlPayload(page, {
            profileUrl: facebookUrl,
            graphqlUrl: facebookGraphqlUrl,
            timeout: actionTimeout,
        });
        console.log(`[SESSION-COMPARE-TEST] Facebook: ${facebookResult.status}`);
        if (!facebookResult.success) {
            logCaptureError("Facebook", facebookResult);
            throw new Error(facebookResult.error ?? facebookResult.status);
        }

        console.log("[SESSION-COMPARE-TEST] Захоплюємо Accounts Center GraphQL request");
        const accountsCenterResult = await captureGraphqlPayload(page, {
            profileUrl: accountsCenterUrl,
            graphqlUrl: accountsCenterGraphqlUrl,
            timeout: actionTimeout,
        });
        console.log(`[SESSION-COMPARE-TEST] Accounts Center: ${accountsCenterResult.status}`);
        if (!accountsCenterResult.success) {
            logCaptureError("Accounts Center", accountsCenterResult);
            throw new Error(accountsCenterResult.error ?? accountsCenterResult.status);
        }

        const report = buildComparisonReport(
            facebookResult.data,
            accountsCenterResult.data
        );
        const sameFields = report.filter((item) => item.comparison === "однакове").length;
        const differentFields = report.filter((item) => item.comparison === "різне").length;

        console.log("[SESSION-COMPARE-TEST] Порівняння завершено", {
            sameFields,
            differentFields,
            notComparable: report.length - sameFields - differentFields,
        });
        console.table(report);
    } catch (error) {
        console.error("\n[SESSION-COMPARE-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            console.log(`[SESSION-COMPARE-TEST] AdsPower-профіль ${profileNo} залишено відкритим для перевірки.`);
        }
        console.log("=".repeat(72));
    }
}


main();
