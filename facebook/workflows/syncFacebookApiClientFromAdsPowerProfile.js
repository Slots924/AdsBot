import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../actions/openPageWithoutPopups.js";
import checkProfileBeforeLaunch from "../../workflows/profile/checkProfileBeforeLaunch.js";
import checkFacebookAfterLaunch from "../../workflows/profile/checkFacebookAfterLaunch.js";


import { readFacebookBrowserCredentials } from "../api/browserCredentials.js";


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
        const readiness = await checkProfileBeforeLaunch({
            adsPower, profile,
            checks: { adsPowerReady: true, blockedTags: ["BAN", "LOGIN_ERROR"] },
        });
        if (!readiness.ok) throw new Error("AdsPower-профіль не готовий до роботи");

        await onProgress({ stage: "browser", message: "Відкриваємо профіль AdsPower" });
        const browserData = await adsPower.openProfile(normalizedProfileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
            restoreLastOpenedTabs: false,
            proxyDetection: true,
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
        const facebook = await checkFacebookAfterLaunch({
            adsPower, profile, page, signal,
            checks: { loggedIn: true, active: true, ensureEnglish: false },
        });
        if (!facebook.ok) {
            throw new Error(facebook.failedCheck === "loggedIn"
                ? "Не вдалося підтвердити вхід у Facebook"
                : "Facebook-акаунт не активний");
        }
        assertNotAborted();

        await onProgress({ stage: "credentials", message: "Оновлюємо дані API-клієнта" });
        return await readFacebookBrowserCredentials(page);
    } finally {
        await browser?.disconnect().catch(() => {});
        if (opened) await adsPower.closeProfile(normalizedProfileNo).catch(() => {});
    }
}
