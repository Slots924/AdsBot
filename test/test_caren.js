import "dotenv/config";

import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import puppeteer from "puppeteer-core";

import AdsPower from "../classes/AdsPower.js";
import openPageWithoutPopups from "../facebook/actions/openPageWithoutPopups.js";
import publishFacebookPersonalProfileMediaPostsWithDates from "../facebook/actions/publishFacebookPersonalProfileMediaPostsWithDates.js";
import { waitHuman } from "../facebook/browser/timing.js";
import ensureAdsPowerProfileReady from "../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../workflows/profile/ensureFacebookAccountLoggedIn.js";

const PROFILE_NO = 1881;
const PHOTO_DIR = "C:\\Users\\Darkness\\Desktop\\Work\\Photo\\ES\\Man\\1";
const TIMEOUT = 90000;

const supportedExt = /\.(avi|bmp|gif|heic|heif|jpe?g|m4v|mkv|mov|mp4|mpeg?|mpg|png|tiff?|webm|webp|wmv)$/i;

function getRandomDate1to3YearsAgo() {
    const now = new Date();
    const minDays = 365;
    const maxDays = 365 * 3;
    const daysBack = Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
    const date = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

async function getPhotos() {
    const resolvedDir = path.resolve(PHOTO_DIR);
    console.log("Перевіряємо папку (resolve):", resolvedDir);

    try {
        // Перевіряємо чи папка існує
        const dirStat = await stat(resolvedDir);
        if (!dirStat.isDirectory()) {
            console.error("Шлях існує, але це НЕ папка!");
            return [];
        }
        console.log("Папка існує. Читаємо файли...");

        const files = await readdir(resolvedDir);
        console.log("Всього файлів у папці:", files.length);

        if (files.length > 0) {
            console.log("Приклади файлів у папці (перші 10):");
            files.slice(0, 10).forEach((f, i) => console.log("   ", i + 1, f));
        }

        const images = files
            .filter((f) => supportedExt.test(f))
            .map((f) => path.join(resolvedDir, f));

        console.log("Після фільтра по розширенню знайдено фото:", images.length);

        if (images.length > 0) {
            console.log("Перші приклади повних шляхів до фото:");
            images.slice(0, 5).forEach((p, i) => console.log("  ", i + 1, p));
        } else {
            console.log("Увага: жоден файл не пройшов фільтр по розширенню.");
        }

        return images;
    } catch (e) {
        console.error("ПОМИЛКА при доступі до папки:", resolvedDir);
        console.error("Код помилки:", e.code);
        console.error("Повідомлення:", e.message);
        if (e.code === "ENOENT") {
            console.error(">>> Папка не існує за цим шляхом!");
        } else if (e.code === "EACCES") {
            console.error(">>> Немає прав на читання папки!");
        }
        return [];
    }
}

const logEvents = [];
const detailedLogger = {
    info(message, fields) {
        const entry = { level: "info", time: new Date().toISOString(), message, fields };
        logEvents.push(entry);
        console.log("[INFO]", message, fields ? JSON.stringify(fields) : "");
    },
    error(message, fields) {
        const entry = { level: "error", time: new Date().toISOString(), message, fields };
        logEvents.push(entry);
        console.error("[ERROR]", message, fields ? JSON.stringify(fields) : "");
    },
    warn(message, fields) {
        const entry = { level: "warn", time: new Date().toISOString(), message, fields };
        logEvents.push(entry);
        console.warn("[WARN]", message, fields ? JSON.stringify(fields) : "");
    },
};

async function runTest() {
    const report = {
        title: "Тест publishFacebookPersonalProfileMediaPostsWithDates для профілю 1881",
        profileNo: PROFILE_NO,
        photoDir: PHOTO_DIR,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        posts: null,
        actionResult: null,
        logEvents: null,
        error: null,
        stack: null,
        lastStage: null,
    };

    let browser = null;
    let profileOpened = false;

    console.log("=== ТЕСТ КАРЕN для профілю AdsPower 1881 ===");
    console.log("Папка фото:", PHOTO_DIR);
    console.log("Будемо використовувати випадкові дати 1-3 роки тому");

    try {
        const photos = await getPhotos();
        if (photos.length === 0) {
            console.error(">>> ДЕТАЛЬНА ДІАГНОСТИКА:");
            console.error("   PHOTO_DIR (оригінал):", PHOTO_DIR);
            console.error("   Після path.resolve:", path.resolve(PHOTO_DIR));
            console.error("   Підтримувані розширення:", supportedExt);
            throw new Error("Не знайдено фото у папці (дивись логи вище для діагностики)");
        }

        // Робимо окремі пости з 1 фото кожен (беремо перші 3-4)
        const posts = photos.slice(0, 4).map((photoPath, index) => ({
            mediaPaths: [photoPath],
            targetDate: getRandomDate1to3YearsAgo(),
        }));

        report.posts = posts.map((p, i) => ({
            sequence: i + 1,
            mediaPaths: p.mediaPaths,
            targetDate: p.targetDate,
        }));

        console.log(`Знайдено фото: ${photos.length}`);
        console.log(`Створюємо ${posts.length} постів з випадковими датами`);

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

        console.log("5. Запускаємо publishFacebookPersonalProfileMediaPostsWithDates...");
        console.log("Пости:", JSON.stringify(posts, null, 2));

        const onProgress = (event) => {
            console.log("[PROGRESS]", JSON.stringify(event));
        };

        report.actionResult = await publishFacebookPersonalProfileMediaPostsWithDates(page, {
            posts,
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

        // Спроба витягнути останній stage з логів
        const lastStageLog = logEvents.slice().reverse().find((e) => e.fields && e.fields.stage);
        if (lastStageLog) {
            report.lastStage = lastStageLog.fields.stage;
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

        // Також виводимо всі логи окремо
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
