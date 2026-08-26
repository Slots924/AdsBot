import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import deleteAllFacebookPersonalProfilePosts from "../../facebook/actions/deleteAllFacebookPersonalProfilePosts.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import { waitHuman } from "../../facebook/browser/timing.js";
import AppLogger from "../../services/logging/AppLogger.js";
import { configureRuntimeLogger } from "../../services/logging/runtimeLogger.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const profileNo = 1882;
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
        `facebook-personal-delete-all-posts-1882_`
        + `${createTimestamp(report.finishedAt)}.json`
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
        scope: "manual.facebook-personal-post-cleanup",
        context: { profileNo },
    });
    configureRuntimeLogger(logger);

    const unsubscribe = logger.subscribe((entry) => {
        if (!String(entry.event).startsWith("facebook.personal_posts.")) {
            return;
        }

        const selector = entry.fields?.selector
            ? ` | selector: ${entry.fields.selector}`
            : "";

        console.log(
            `[${entry.fields?.stage ?? "UNKNOWN"}] ${entry.message}${selector}`
        );
    });

    const adsPower = new AdsPower();
    const report = {
        title: "Ручний тест видалення постів Facebook, профіль 1882",
        profileNo,
        browserMode,
        keepOpen,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        finalUrl: null,
        action: null,
        progress: [],
        error: null,
        cleanupErrors: [],
    };
    let browser;
    let profileOpened = false;

    console.log("=== deleteAllFacebookPersonalProfilePosts 1882 ===");
    console.log(`AdsPower-профіль: ${profileNo}`);
    console.log(`Режим браузера: ${browserMode}`);

    try {
        console.log("1. Перевіряємо AdsPower-профіль...");
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

        console.log("3. Перевіряємо вхід у Facebook...");
        await openPageWithoutPopups(page, "https://www.facebook.com/", {
            timeout,
        });
        const loggedIn = await ensureFacebookAccountLoggedIn(
            adsPower,
            profile,
            page
        );

        if (!loggedIn) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }

        const active = await ensureFacebookAccountActive(
            adsPower,
            profile,
            page
        );

        if (!active) {
            throw new Error("Facebook-акаунт неактивний");
        }

        console.log("4. Відкриваємо особистий профіль...");
        await openPageWithoutPopups(page, "https://www.facebook.com/me", {
            timeout,
        });
        await page.waitForFunction(
            () => document.readyState === "complete",
            { timeout }
        );
        await waitHuman("long");
        console.log(`Сторінка профілю: ${page.url()}`);

        console.log("5. Видаляємо / ховаємо пости зі стрічки...");
        report.action = await deleteAllFacebookPersonalProfilePosts(page, {
            timeout,
            logger: logger.child(
                "facebook-personal-post-cleanup-action",
                { profileNo }
            ),
            onProgress: async (event) => {
                report.progress.push({
                    at: new Date().toISOString(),
                    ...event,
                });
                console.log(`[progress] ${JSON.stringify(event)}`);
            },
        });
        report.finalUrl = page.url();

        console.log("\n=== Результат ===");
        console.log(JSON.stringify(report.action, null, 2));

        if (!report.action.success) {
            process.exitCode = 1;
        }
    } catch (error) {
        report.error = {
            code: error.code ?? "MANUAL_PERSONAL_DELETE_ALL_POSTS_FAILED",
            message: error.message,
            stack: error.stack ?? null,
        };
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        report.finishedAt = new Date().toISOString();

        if (browser) {
            browser.disconnect();
        }

        if (profileOpened && !keepOpen) {
            try {
                await adsPower.closeProfile(profileNo);
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

        const reportPath = await saveReport(report);
        unsubscribe();
        await logger.flush();
        console.log(`Звіт: ${reportPath}`);
    }
}


runTest().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
});
