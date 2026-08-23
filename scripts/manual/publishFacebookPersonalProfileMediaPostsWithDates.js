import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import publishFacebookPersonalProfileMediaPostsWithDates from "../../facebook/actions/publishFacebookPersonalProfileMediaPostsWithDates.js";
import { waitHuman } from "../../facebook/browser/timing.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const argumentsWithoutFlags = process.argv.slice(2)
    .filter((argument) => !argument.startsWith("--"));
const profileNo = Number(argumentsWithoutFlags[0]);
const manifestPath = argumentsWithoutFlags[1]
    ? path.resolve(argumentsWithoutFlags[1])
    : null;
const confirmed = process.argv.includes("--confirm-publish-with-dates");
const keepOpen = process.argv.includes("--keep-open");
const browserMode = process.argv.includes("--headless")
    ? "headless"
    : "visible";
const timeout = 90000;

if (!Number.isInteger(profileNo) || profileNo <= 0) {
    throw new Error("Першим аргументом вкажіть номер AdsPower-профілю");
}
if (!manifestPath) {
    throw new Error("Другим аргументом вкажіть шлях до JSON-маніфесту постів");
}
if (!confirmed) {
    throw new Error(
        "Для реальної публікації додайте --confirm-publish-with-dates"
    );
}


function createTimestamp(value) {
    return new Date(value).toISOString().replace(/[:.]/g, "-");
}


async function saveReport(report) {
    const directory = path.resolve("./data/reports");
    const filePath = path.join(
        directory,
        `facebook-personal-posts-with-dates-${profileNo}_`
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


async function readManifest() {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const posts = Array.isArray(parsed) ? parsed : parsed.posts;

    if (!Array.isArray(posts) || posts.length === 0) {
        throw new Error("Маніфест має бути масивом постів або об’єктом { posts: [...] }");
    }
    return posts.map((post) => ({
        ...post,
        mediaPaths: post.mediaPaths.map((mediaPath) =>
            path.resolve(path.dirname(manifestPath), mediaPath)
        ),
    }));
}


async function runTest() {
    const posts = await readManifest();
    const adsPower = new AdsPower();
    const report = {
        title: "Ручний тест двофазної публікації постів із вибраними датами",
        profileNo,
        manifestPath,
        posts,
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

    console.log("=== publishFacebookPersonalProfileMediaPostsWithDates ===");
    console.log(`AdsPower-профіль: ${profileNo}`);
    console.log(`Маніфест: ${manifestPath}`);
    console.log(`Кількість постів: ${posts.length}`);

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
        if (!active) throw new Error("Facebook-акаунт неактивний");

        console.log("4. Відкриваємо особистий профіль...");
        await openPageWithoutPopups(page, "https://www.facebook.com/me", {
            timeout,
        });
        await page.waitForFunction(
            () => document.readyState === "complete",
            { timeout }
        );
        await waitHuman("long");

        console.log("5. Публікуємо всі пости, потім змінюємо всі дати...");
        report.action = await publishFacebookPersonalProfileMediaPostsWithDates(
            page,
            {
                posts,
                timeout,
                logger: console,
                onProgress: (event) => console.log(
                    `[progress] ${JSON.stringify(event)}`
                ),
            }
        );
        report.finalUrl = page.url();
        console.log(JSON.stringify(report.action, null, 2));
        if (!report.action.success) process.exitCode = 1;
    } catch (error) {
        report.error = {
            code: error.code ?? "MANUAL_PERSONAL_POSTS_WITH_DATES_FAILED",
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
        const reportPath = await saveReport(report);
        console.log(`Звіт: ${reportPath}`);
    }
}


await runTest();
