import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


// AdsPower-профіль, на якому запускається ручний тест.
const profileNo = 1880;

// Час очікування першого GraphQL POST-запиту.
const actionTimeout = 30000;


// Друкує етап тесту в єдиному форматі, щоб по логах було легко орієнтуватися.
function logStep(message, details = null) {
    console.log(`\n[CAPTURE-GRAPHQL] ${message}`);

    if (details) {
        console.dir(details, { depth: null, colors: true });
    }
}


// Маскує чутливі поля перед виведенням payload у консоль.
// Сам action при цьому повертає повний payload без змін.
function maskSensitivePayload(payload) {
    const sensitiveFieldPattern = /token|cookie|password|secret|dtsg|jazoest|lsd|user|variable|spin|dyn|csr/i;

    return Object.fromEntries(
        Object.entries(payload ?? {}).map(([key, value]) => [
            key,
            sensitiveFieldPattern.test(key) ? "[ЗАМІНЕНО У ВИВОДІ]" : value,
        ])
    );
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("ТЕСТ ACTION captureGraphqlPayload");
    console.log("=".repeat(72));
    logStep("Параметри тесту", {
        profileNo,
        actionTimeout,
        targetUrl: "https://www.facebook.com/me",
    });

    try {
        logStep(`Отримуємо інформацію про AdsPower-профіль ${profileNo}`);
        const profile = await adsPower.getProfileByNo(profileNo);

        if (!profile) {
            throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);
        }

        logStep("Перевіряємо готовність профілю");
        const profileReady = await ensureAdsPowerProfileReady(
            adsPower,
            profile
        );

        if (!profileReady) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        logStep("Відкриваємо профіль у видимому режимі");
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;

        logStep("Підключаємо Puppeteer до відкритого профілю");
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const page = (await browser.pages())[0] ?? await browser.newPage();
        logStep("Поточна сторінка браузера", { url: page.url() });

        logStep("Запускаємо action captureGraphqlPayload");
        const result = await captureGraphqlPayload(page, {
            timeout: actionTimeout,
        });

        logStep("Результат action", {
            success: result.success,
            status: result.status,
            profileUrl: result.profileUrl,
            navigationSuccess: result.navigationSuccess,
            navigationError: result.navigationError,
        });

        if (result.success) {
            const payload = result.data ?? {};

            logStep("Отримано payload", {
                fieldsCount: Object.keys(payload).length,
                fields: Object.keys(payload),
            });

            console.log("\nPayload без чутливих значень:");
            console.dir(maskSensitivePayload(payload), {
                depth: null,
                colors: true,
            });
        } else {
            console.error("\nAction завершився невдало:");
            console.error(result.error ?? "Причина помилки не вказана");
            process.exitCode = 1;
        }
    } catch (error) {
        console.error("\n[CAPTURE-GRAPHQL] Помилка manual-тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) {
            logStep("Відключаємо Puppeteer");
            browser.disconnect();
        }

        if (profileOpened) {
            logStep(`Закриваємо AdsPower-профіль ${profileNo}`);
            await adsPower.closeProfile(profileNo).catch((error) => {
                console.error(
                    `[CAPTURE-GRAPHQL] Не вдалося закрити профіль: ${error.message}`
                );
                process.exitCode = 1;
            });
        }

        console.log("\n" + "=".repeat(72));
        console.log("ТЕСТ captureGraphqlPayload ЗАВЕРШЕНО");
        console.log("=".repeat(72));
    }
}


main();
