import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import publishFacebookPersonalProfileMediaPost from "../../facebook/actions/publishFacebookPersonalProfileMediaPost.js";
import { waitHuman } from "../../facebook/browser/timing.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const argumentsWithoutFlags = process.argv.slice(2)
    .filter((argument) => !argument.startsWith("--"));
const profileNo = Number(argumentsWithoutFlags[0]);
const mediaPaths = argumentsWithoutFlags.slice(1);
const keepOpen = process.argv.includes("--keep-open");
const browserMode = process.argv.includes("--headless")
    ? "headless"
    : "visible";
const timeout = 90000;

if (!Number.isInteger(profileNo) || profileNo <= 0) {
    throw new Error("Першим аргументом вкажіть номер AdsPower-профілю");
}

if (mediaPaths.length === 0) {
    throw new Error("Після номера профілю вкажіть хоча б один медіафайл");
}


function createTimestamp(value) {
    return new Date(value).toISOString().replace(/[:.]/g, "-");
}


async function saveReport(report) {
    const directory = path.resolve("./data/reports");
    const filePath = path.join(
        directory,
        `facebook-personal-media-post-${profileNo}_${createTimestamp(report.finishedAt)}.json`
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
    const adsPower = new AdsPower();
    const report = {
        title: "Ручний тест публікації медіапоста в особистий Facebook-профіль",
        profileNo,
        mediaPaths,
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

    console.log("=== publishFacebookPersonalProfileMediaPost ===");
    console.log(`AdsPower-профіль: ${profileNo}`);
    console.log("Медіафайли:");
    console.table(mediaPaths);
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

        console.log("4. Відкриваємо особистий Facebook-профіль...");
        await openPageWithoutPopups(page, "https://www.facebook.com/me", {
            timeout,
        });
        await page.waitForFunction(
            () => document.readyState === "complete",
            { timeout }
        );
        await waitHuman("long");

        console.log("5. Публікуємо медіапост з аудиторією Public...");
        report.action = await publishFacebookPersonalProfileMediaPost(page, {
            mediaPaths,
            timeout,
        });
        report.finalUrl = page.url();
        console.log(JSON.stringify(report.action, null, 2));

        if (!report.action.success) {
            process.exitCode = 1;
        }
    } catch (error) {
        report.error = {
            code: error.code ?? "MANUAL_PERSONAL_MEDIA_POST_FAILED",
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
        }

        const reportPath = await saveReport(report);
        console.log(`Звіт: ${reportPath}`);
    }
}


await runTest();
