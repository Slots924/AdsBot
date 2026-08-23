import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import getFacebookPersonalProfileCreationDate from "../../facebook/actions/getFacebookPersonalProfileCreationDate.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import { waitHuman } from "../../facebook/browser/timing.js";
import AppLogger from "../../services/logging/AppLogger.js";
import { configureRuntimeLogger } from "../../services/logging/runtimeLogger.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const positionalArguments = process.argv.slice(2)
    .filter((argument) => !argument.startsWith("--"));
const profileNo = Number(positionalArguments[0]);
const keepOpen = process.argv.includes("--keep-open");
const browserMode = process.argv.includes("--headless")
    ? "headless"
    : "visible";
const timeout = 90000;

if (!Number.isInteger(profileNo) || profileNo <= 0) {
    throw new Error(
        "Першим аргументом вкажіть додатний номер AdsPower-профілю"
    );
}


function createTimestamp(value) {
    return new Date(value).toISOString().replace(/[:.]/g, "-");
}


async function saveReport(report) {
    const directory = path.resolve("./data/reports");
    const filePath = path.join(
        directory,
        `facebook-profile-creation-date-${profileNo}_`
        + `${createTimestamp(report.startedAt)}.json`
    );
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return filePath;
}


async function runTest() {
    const logger = new AppLogger({
        scope: "manual.facebook-profile-creation-date",
        context: { profileNo },
    });
    configureRuntimeLogger(logger);
    const unsubscribe = logger.subscribe((entry) => {
        if (!String(entry.event).startsWith(
            "facebook.profile_creation_date."
        )) return;

        const selector = entry.fields?.selector
            ? ` | selector: ${entry.fields.selector}`
            : "";
        console.log(
            `[${entry.fields?.stage ?? "UNKNOWN"}] `
            + `${entry.message}${selector}`
        );
    });
    const actionLogger = logger.child(
        "facebook-profile-creation-date-action",
        { profileNo }
    );
    const adsPower = new AdsPower();
    const report = {
        title: "Ручне читання дати створення Facebook-профілю",
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

    console.log("=== getFacebookPersonalProfileCreationDate ===");
    console.log(`AdsPower-профіль: ${profileNo}`);

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        const ready = await ensureAdsPowerProfileReady(adsPower, profile);
        if (!ready) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

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
        if (!active) throw new Error("Facebook-акаунт неактивний");

        await openPageWithoutPopups(page, "https://www.facebook.com/me", {
            timeout,
        });
        await page.waitForFunction(
            () => document.readyState === "complete",
            { timeout }
        );
        await waitHuman("long");

        report.action = await getFacebookPersonalProfileCreationDate(page, {
            timeout,
            logger: actionLogger,
            onProgress: async (event) => {
                report.progress.push({
                    at: new Date().toISOString(),
                    ...event,
                });
            },
        });
        report.finalUrl = page.url();
        console.log(JSON.stringify(report.action, null, 2));
        if (!report.action.success) process.exitCode = 1;
    } catch (error) {
        report.error = {
            code: error.code ?? "MANUAL_PROFILE_CREATION_DATE_FAILED",
            message: error.message,
            stack: error.stack ?? null,
        };
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        report.finishedAt = new Date().toISOString();
        if (browser) browser.disconnect();

        if (profileOpened && !keepOpen) {
            try {
                await adsPower.closeProfile(profileNo);
            } catch (error) {
                report.cleanupErrors.push(
                    `AdsPower closeProfile: ${error.message}`
                );
            }
        }

        try {
            const reportPath = await saveReport(report);
            console.log(`Звіт: ${reportPath}`);
        } catch (error) {
            console.error(`Не вдалося записати звіт: ${error.message}`);
            process.exitCode = 1;
        }
        unsubscribe();
        await logger.flush();
    }
}


await runTest();
