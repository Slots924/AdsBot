import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import checkProfileBeforeLaunch from "./checkProfileBeforeLaunch.js";
import checkFacebookAfterLaunch from "./checkFacebookAfterLaunch.js";


export default async function checkFacebookCommentProfile({
    adsPower,
    profile,
    browserMode = "visible",
    disableImages = false,
    signal,
} = {}) {
    const profileNo = String(profile?.profile_no ?? "невідомий");
    const result = {
        profileNo,
        outcome: "failed",
        login: "—",
        active: "—",
        english: "—",
        error: null,
    };
    let browser;
    let profileOpened = false;
    const assertNotAborted = () => {
        if (signal?.aborted) throw Object.assign(new Error("Перевірку перервано"), { name: "AbortError" });
    };
    try {
        assertNotAborted();
        const readiness = await checkProfileBeforeLaunch({
            adsPower, profile,
            checks: { adsPowerReady: true, blockedTags: ["BAN", "LOGIN_ERROR"] },
        });
        if (readiness.blockedTag === "BAN") {
            result.outcome = "banned";
            result.active = "BAN TAG";
            return result;
        }
        if (!readiness.ok) {
            throw new Error("AdsPower-профіль не готовий до відкриття");
        }
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
            restoreLastOpenedTabs: false,
            proxyDetection: true,
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode });
        await openPageWithoutPopups(page, "https://www.facebook.com/");
        assertNotAborted();

        const facebook = await checkFacebookAfterLaunch({
            adsPower, profile, page, signal,
            checks: { loggedIn: true, active: true, ensureEnglish: true },
            onResult: (field, passed) => { result[field] = passed ? "OK" : "FAIL"; },
        });
        if (facebook.failedCheck === "loggedIn") {
            result.outcome = "not_logged_in";
            result.error = "Facebook-вхід не підтверджено";
            return result;
        }
        if (facebook.failedCheck === "active") {
            const state = await detectFacebookState(page).catch(() => "UNKNOWN");
            result.outcome = state === "BANNED" ? "banned" : "inactive";
            result.error = `Facebook state: ${state}`;
            return result;
        }
        if (facebook.failedCheck === "ensureEnglish") {
            result.outcome = "failed";
            result.error = "Не вдалося завершити ensureEnglish";
            return result;
        }
        result.outcome = "working";
    } catch (error) {
        result.outcome = signal?.aborted ? "failed" : "error";
        result.error = signal?.aborted ? "Перевірку перервано" : error.message;
    } finally {
        try { browser?.disconnect(); } catch {}
        if (profileOpened) {
            try { await adsPower.closeProfile(profileNo); } catch (error) {
                result.cleanupError = error.message;
            }
        }
    }
    return result;
}
