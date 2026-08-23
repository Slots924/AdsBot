import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import changeFacebookCoverPhoto from "../../facebook/actions/changeFacebookCoverPhoto.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import { waitHuman } from "../../facebook/browser/timing.js";
import AppLogger from "../../services/logging/AppLogger.js";
import { configureRuntimeLogger } from "../../services/logging/runtimeLogger.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const profileNo = 1881;
const imagePath = String.raw`C:\Users\Darkness\Downloads\Group 2 (2)_19d2944bc4f.png`;
const timeout = 90000;
const keepOpen = process.argv.includes("--keep-open");
const browserMode = process.argv.includes("--headless")
    ? "headless"
    : "visible";


function createTimestamp(value) {
    return new Date(value).toISOString().replace(/[:.]/g, "-");
}


async function saveReport(report) {
    const directory = path.resolve("./data/reports");
    const filePath = path.join(
        directory,
        `facebook-cover-change-1881_${createTimestamp(report.finishedAt)}.json`
    );

    await mkdir(directory, { recursive: true });
    await writeFile(
        filePath,
        `${JSON.stringify(report, null, 2)}\n`,
        "utf8"
    );

    return filePath;
}


async function runTest() {
    const logger = new AppLogger({
        scope: "manual.facebook-cover",
        context: { profileNo },
    });
    configureRuntimeLogger(logger);

    const unsubscribe = logger.subscribe((entry) => {
        if (!String(entry.event).startsWith("facebook.cover_change.")) {
            return;
        }

        const selector = entry.fields?.selector
            ? ` | selector: ${entry.fields.selector}`
            : "";
        const attempt = entry.fields?.attempt
            ? ` | attempt: ${entry.fields.attempt}`
            : "";

        console.log(
            `[${entry.fields?.stage ?? "UNKNOWN"}] ${entry.message}${attempt}${selector}`
        );
    });

    const adsPower = new AdsPower();
    const report = {
        title: "Ручний тест зміни шпалер Facebook",
        profileNo,
        imagePath,
        browserMode,
        keepOpen,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        finalUrl: null,
        action: null,
        error: null,
        cleanupErrors: [],
    };
    let browser;
    let profileOpened = false;

    console.log("=== Ручний тест changeFacebookCoverPhoto ===");
    console.log(`AdsPower-профіль: ${profileNo}`);
    console.log(`Шпалери: ${imagePath}`);
    console.log(`Режим браузера: ${browserMode}`);

    try {
        console.log("1. Отримуємо та перевіряємо AdsPower-профіль...");
        const profile = await adsPower.getProfileByNo(profileNo);
        const ready = await ensureAdsPowerProfileReady(adsPower, profile);

        if (!ready) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        console.log("2. Відкриваємо AdsPower-профіль...");
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode,
        });
        profileOpened = true;

        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();

        if (browserMode === "headless") {
            await page.setViewport({
                width: 1280,
                height: 900,
                deviceScaleFactor: 1,
            });
        }

        page.setDefaultTimeout(timeout);
        page.setDefaultNavigationTimeout(timeout);

        console.log("3. Відкриваємо Facebook і перевіряємо логін...");
        await openPageWithoutPopups(
            page,
            "https://www.facebook.com/",
            { timeout }
        );

        const loggedIn = await ensureFacebookAccountLoggedIn(
            adsPower,
            profile,
            page
        );

        if (!loggedIn) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }

        console.log("4. Перевіряємо активність Facebook-акаунта...");
        const active = await ensureFacebookAccountActive(
            adsPower,
            profile,
            page
        );

        if (!active) {
            throw new Error("Facebook-акаунт неактивний");
        }

        console.log("5. Відкриваємо домашню сторінку власного профілю...");
        await openPageWithoutPopups(
            page,
            "https://www.facebook.com/me",
            { timeout }
        );
        await page.waitForFunction(
            () => document.readyState === "complete",
            { timeout }
        );

        // Через повільний проксі даємо React час під'єднати обробники.
        await waitHuman("long");
        console.log(`Сторінка профілю відкрита: ${page.url()}`);

        console.log("6. Запускаємо зміну шпалер...");
        report.action = await changeFacebookCoverPhoto(page, {
            imagePath,
            logger: logger.child("facebook-cover-action", { profileNo }),
            timeout,
        });
        report.finalUrl = page.url();

        console.log("\n=== Результат action ===");
        console.log(JSON.stringify(report.action, null, 2));

        if (!report.action.success) {
            process.exitCode = 1;
        }
    } catch (error) {
        report.error = {
            code: error.code ?? "MANUAL_COVER_TEST_FAILED",
            message: error.message,
            stage: error.stage ?? null,
            selector: error.selector ?? null,
            stack: error.stack ?? null,
        };
        console.error("Критична помилка ручного тесту:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        report.finishedAt = new Date().toISOString();

        if (browser) {
            try {
                browser.disconnect();
                console.log("Puppeteer від'єднано від браузера");
            } catch (error) {
                report.cleanupErrors.push(
                    `Puppeteer disconnect: ${error.message}`
                );
            }
        }

        if (profileOpened && !keepOpen) {
            try {
                await adsPower.closeProfile(profileNo);
                console.log(`AdsPower-профіль ${profileNo} закрито`);
            } catch (error) {
                report.cleanupErrors.push(
                    `AdsPower closeProfile: ${error.message}`
                );
            }
        } else if (profileOpened) {
            console.log(
                `AdsPower-профіль ${profileNo} залишено відкритим через --keep-open`
            );
        }

        try {
            const reportPath = await saveReport(report);
            console.log(`Детальний JSON-звіт: ${reportPath}`);
        } catch (error) {
            console.error(`Не вдалося записати JSON-звіт: ${error.message}`);
            process.exitCode = 1;
        }

        unsubscribe();
        await logger.flush();
    }
}


runTest().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
});
