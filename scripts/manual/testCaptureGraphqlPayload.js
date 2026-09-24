import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import getAboutSectionTokens
    from "../../facebook/api-actions/getAboutSectionTokens.js";
import updateBio
    from "../../facebook/api-actions/updateBio.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


// AdsPower-профіль, на якому запускається ручний тест.
const profileNo = 1880;

// Час очікування першого GraphQL POST-запиту.
const actionTimeout = 30000;

// Усі секції About, для яких тест отримує токени.
const aboutSections = [
    "directory_intro",
    "directory_personal_details",
    "directory_work",
    "directory_education",
    "directory_activites",
    "directory_interests",
    "directory_travel",
    "directory_links",
    "directory_contact_info",
    "directory_names",
    "about_details",
];

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


// Показує токени компактно: видно, що вони отримані, але не друкується весь секрет.
function summarizeTokens(tokensBySection) {
    return Object.fromEntries(
        Object.entries(tokensBySection ?? {}).map(([section, tokens]) => ({
            [section]: {
                collectionToken: maskToken(tokens?.collectionToken),
                sectionToken: maskToken(tokens?.sectionToken),
                rawSectionToken: maskToken(tokens?.rawSectionToken),
            },
        }))
    );
}


// Залишає початок і кінець токена для візуальної перевірки у консолі.
function maskToken(token) {
    const value = String(token ?? "");
    if (!value) return null;
    if (value.length <= 12) return "********";

    return `${value.slice(0, 6)}...${value.slice(-6)}`;
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("ТЕСТ ACTION-ЛАНЦЮЖКА ДЛЯ FACEBOOK ABOUT");
    console.log("=".repeat(72));
    logStep("Параметри тесту", {
        profileNo,
        actionTimeout,
        targetUrl: "https://www.facebook.com/me",
        aboutSections,
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

        if (!result.success) {
            throw new Error(
                `captureGraphqlPayload завершився зі статусом ${result.status}: `
                + `${result.error ?? "невідома помилка"}`
            );
        }

        const commonPayload = result.data ?? {};

        logStep("Отримано commonPayload", {
            fieldsCount: Object.keys(commonPayload).length,
            fields: Object.keys(commonPayload),
        });

        console.log("\n1. Отриманий payload без чутливих значень:");
        console.dir(maskSensitivePayload(commonPayload), {
            depth: null,
            colors: true,
        });

        logStep("Отримуємо токени для всіх секцій About");
        const tokensResult = await getAboutSectionTokens({
            page,
            commonPayload,
            sections: aboutSections,
            timeout: actionTimeout,
        });

        logStep("Результат getAboutSectionTokens", {
            success: tokensResult.success,
            status: tokensResult.status,
            httpStatus: tokensResult.httpStatus,
            missingSections: tokensResult.missingSections,
            error: tokensResult.error,
        });

        console.log("\n2. Отримані токени по секціях:");
        console.dir(summarizeTokens(tokensResult.data), {
            depth: null,
            colors: true,
        });

        if (!tokensResult.success) {
            throw new Error(
                `getAboutSectionTokens завершився зі статусом ${tokensResult.status}: `
                + `${tokensResult.error ?? "токени отримані не для всіх секцій"}`
            );
        }

        const bioTokens = tokensResult.data.directory_intro;

        if (!bioTokens) {
            throw new Error("Для directory_intro не отримані токени Bio");
        }

        // Порожній рядок передаємо для очищення поточного Bio.
        const bio = "";

        logStep("Очищуємо Bio", {
            selectedBio: bio,
            collectionTokenReceived: Boolean(bioTokens?.collectionToken),
            sectionTokenReceived: Boolean(bioTokens?.sectionToken),
        });

        const updateResult = await updateBio({
            page,
            commonPayload,
            collectionToken: bioTokens.collectionToken,
            sectionToken: bioTokens.sectionToken,
            value: bio,
            timeout: actionTimeout,
        });

        logStep("3. Результат updateBio", {
            success: updateResult.success,
            status: updateResult.status,
            httpStatus: updateResult.httpStatus,
            error: updateResult.error,
        });

        console.log("\nВідповідь Facebook від updateBio:");
        console.dir(updateResult.data, { depth: null, colors: true });

        if (!updateResult.success) {
            throw new Error(
                `updateBio завершився зі статусом ${updateResult.status}: `
                + `${updateResult.error ?? "невідома помилка"}`
            );
        }

        console.log("\nBio успішно очищено");
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
            logStep(
                `AdsPower-профіль ${profileNo} залишено відкритим для перевірки`
            );
        }

        console.log("\n" + "=".repeat(72));
        console.log("ТЕСТ ACTION-ЛАНЦЮЖКА ЗАВЕРШЕНО");
        console.log("=".repeat(72));
    }
}


main();
