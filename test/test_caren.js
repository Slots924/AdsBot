import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../classes/AdsPower.js";
import fillFacebookPersonalProfileAbout from "../facebook/actions/fillFacebookPersonalProfileAbout.js";
import openPageWithoutPopups from "../facebook/actions/openPageWithoutPopups.js";
import { waitHuman } from "../facebook/browser/timing.js";
import ensureAdsPowerProfileReady from "../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../workflows/profile/ensureFacebookAccountLoggedIn.js";

const PROFILE_NO = 1881;
const TIMEOUT = 90000;

const fields = {
    bio: "Weekend hiker. Coffee in the morning, code at night.",
    work: {
        company: "Northwind Analytics",
        position: "Product Designer",
    },
    education: "University of Edinburgh",
};

const logEvents = [];
const detailedLogger = {
    info(message, extra) {
        const entry = { level: "info", time: new Date().toISOString(), message, extra };
        logEvents.push(entry);
        console.log("[INFO]", message, extra ? JSON.stringify(extra) : "");
    },
    error(message, extra) {
        const entry = { level: "error", time: new Date().toISOString(), message, extra };
        logEvents.push(entry);
        console.error("[ERROR]", message, extra ? JSON.stringify(extra) : "");
    },
    warn(message, extra) {
        const entry = { level: "warn", time: new Date().toISOString(), message, extra };
        logEvents.push(entry);
        console.warn("[WARN]", message, extra ? JSON.stringify(extra) : "");
    },
};

async function runTest() {
    const report = {
        title: "Тест fillFacebookPersonalProfileAbout для профілю 1881",
        profileNo: PROFILE_NO,
        fields,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        actionResult: null,
        logEvents: null,
        error: null,
        stack: null,
        lastStage: null,
    };

    let browser = null;
    let profileOpened = false;

    console.log("=== ТЕСТ ABOUT для профілю AdsPower 1881 ===");
    console.log("Поля:", JSON.stringify(fields, null, 2));

    try {
        const adsPower = new AdsPower();

        console.log("1. Перевіряємо AdsPower-профіль...");
        const profile = await adsPower.getProfileByNo(PROFILE_NO);
        const ready = await ensureAdsPowerProfileReady(adsPower, profile);
        if (!ready) throw new Error("AdsPower-профіль не готовий");

        console.log("2. Відкриваємо профіль 1881...");
        const browserData = await adsPower.openProfile(PROFILE_NO, { browserMode: "visible" });
        profileOpened = true;

        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();
        page.setDefaultTimeout(TIMEOUT);
        page.setDefaultNavigationTimeout(TIMEOUT);

        console.log("3. Перевіряємо Facebook...");
        await openPageWithoutPopups(page, "https://www.facebook.com/", { timeout: TIMEOUT });
        const loggedIn = await ensureFacebookAccountLoggedIn(adsPower, profile, page);
        if (!loggedIn) throw new Error("Не підтверджено вхід у Facebook");

        const active = await ensureFacebookAccountActive(adsPower, profile, page);
        if (!active) throw new Error("Facebook акаунт неактивний");

        console.log("4. Переходимо на особистий профіль...");
        await openPageWithoutPopups(page, "https://www.facebook.com/me", { timeout: TIMEOUT });
        await waitHuman("long");

        console.log("5. Запускаємо fillFacebookPersonalProfileAbout...");
        const onProgress = (event) => {
            console.log("[PROGRESS]", JSON.stringify(event));
        };

        report.actionResult = await fillFacebookPersonalProfileAbout(page, {
            fields,
            timeout: TIMEOUT,
            logger: detailedLogger,
            onProgress,
        });

        report.finalUrl = page.url();
        console.log("=== РЕЗУЛЬТАТ ===");
        console.log(JSON.stringify(report.actionResult, null, 2));

        if (!report.actionResult.success) {
            process.exitCode = 1;
        }
    } catch (error) {
        report.error = {
            code: error.code || "TEST_CAREN_FAILED",
            message: error.message,
            stack: error.stack,
        };
        report.stack = error.stack;
        console.error("=== ПОМИЛКА ===");
        console.error(error.stack || error.message);

        const lastStageLog = logEvents.slice().reverse().find((e) => e.extra && e.extra.stage);
        if (lastStageLog) {
            report.lastStage = lastStageLog.extra.stage;
            console.error("Останній відомий stage:", report.lastStage);
        }

        process.exitCode = 1;
    } finally {
        report.finishedAt = new Date().toISOString();
        report.logEvents = logEvents;

        if (browser) {
            try {
                browser.disconnect();
            } catch {}
        }

        if (profileOpened) {
            try {
                const adsPower = new AdsPower();
                await adsPower.closeProfile(PROFILE_NO);
            } catch (e) {
                console.warn("Не вдалося закрити профіль:", e.message);
            }
        }

        console.log("\n=== ПОВНИЙ ЗВІТ ДЛЯ ДЕБАГІНГУ ===");
        console.log(JSON.stringify(report, null, 2));

        console.log("\n=== ВСІ ЛОГИ ===");
        logEvents.forEach((e) => console.log(e));
    }
}

process.on("uncaughtException", (err) => {
    console.error("UNCAUGHT EXCEPTION:", err.stack || err);
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
    process.exit(1);
});

await runTest();
