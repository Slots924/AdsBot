import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../browser/configureFacebookAutomationWindow.js";
import ensureEnglish from "../actions/ensureEnglish.js";
import openPageWithoutPopups from "../actions/openPageWithoutPopups.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive
    from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn
    from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const adsManagerUrl = "https://www.facebook.com/adsmanager/manage/campaigns";


export function extractFacebookAccessTokenFromHtml(html) {
    const source = String(html ?? "");
    const patterns = [
        /"accessToken"\s*:\s*"(EAA[A-Za-z0-9_-]{20,})"/g,
        /\\"accessToken\\"\s*:\s*\\"(EAA[A-Za-z0-9_-]{20,})\\"/g,
        /\b(EAA[A-Za-z0-9_-]{20,})\b/g,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(source);
        if (match?.[1]) return match[1];
    }
    return "";
}


export default async function syncFacebookApiClientFromAdsPowerProfile({
    adsPower,
    profileNo,
    browserMode = "visible",
    disableImages = false,
    signal,
    onProgress = async () => {},
}) {
    const normalizedProfileNo = String(profileNo ?? "").trim();
    if (!normalizedProfileNo) throw new Error("Не вказано номер AdsPower-профілю");
    if (!adsPower) throw new Error("Не передано клієнт AdsPower");

    const assertNotAborted = () => {
        if (signal?.aborted) {
            throw Object.assign(new Error("Синхронізацію скасовано"), {
                name: "AbortError",
            });
        }
    };
    let browser;
    let opened = false;
    try {
        await onProgress({ stage: "profile", message: "Перевіряємо AdsPower-профіль" });
        const profile = await adsPower.getProfileByNo(normalizedProfileNo);
        assertNotAborted();
        const ready = await ensureAdsPowerProfileReady(adsPower, profile);
        if (!ready) throw new Error("AdsPower-профіль не готовий до роботи");

        await onProgress({ stage: "browser", message: "Відкриваємо профіль AdsPower" });
        const browserData = await adsPower.openProfile(normalizedProfileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
        });
        opened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode });

        await onProgress({ stage: "facebook", message: "Перевіряємо Facebook" });
        await openPageWithoutPopups(page, "https://www.facebook.com/");
        if (!await ensureFacebookAccountLoggedIn(adsPower, profile, page)) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }
        if (!await ensureFacebookAccountActive(adsPower, profile, page)) {
            throw new Error("Facebook-акаунт не активний");
        }
        assertNotAborted();

        await onProgress({ stage: "language", message: "Встановлюємо англійську мову Facebook" });
        await ensureEnglish(page);
        assertNotAborted();

        await onProgress({ stage: "credentials", message: "Оновлюємо дані API-клієнта" });
        await openPageWithoutPopups(page, adsManagerUrl, { timeout: 60000 });
        await page.waitForFunction(
            () => document.documentElement?.innerHTML.includes("EAA"),
            { timeout: 15000 }
        ).catch(() => {});
        const [userAgent, html, cookies] = await Promise.all([
            page.evaluate(() => navigator.userAgent),
            page.content(),
            page.cookies("https://www.facebook.com"),
        ]);
        const accessToken = extractFacebookAccessTokenFromHtml(html);
        if (!accessToken) throw new Error("Не знайдено access token у DOM Ads Manager");
        if (!Array.isArray(cookies) || cookies.length === 0) {
            throw new Error("Не знайдено cookies Facebook");
        }
        if (!String(userAgent).trim()) throw new Error("Не знайдено user agent браузера");
        return { userAgent: String(userAgent), accessToken, cookies };
    } finally {
        await browser?.disconnect().catch(() => {});
        if (opened) await adsPower.closeProfile(normalizedProfileNo).catch(() => {});
    }
}
