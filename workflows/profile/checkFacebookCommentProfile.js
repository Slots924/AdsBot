import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import ensureAdsPowerProfileReady from "./ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "./ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "./ensureFacebookAccountLoggedIn.js";
import hasBanTag from "../../services/profile/tags/hasBanTag.js";


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
        if (hasBanTag(profile)) {
            result.outcome = "banned";
            result.active = "BAN TAG";
            return result;
        }
        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до відкриття");
        }
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
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

        const loggedIn = await ensureFacebookAccountLoggedIn(adsPower, profile, page);
        result.login = loggedIn ? "OK" : "FAIL";
        if (!loggedIn) {
            result.outcome = "not_logged_in";
            result.error = "Facebook-вхід не підтверджено";
            return result;
        }
        const active = await ensureFacebookAccountActive(adsPower, profile, page);
        result.active = active ? "OK" : "FAIL";
        if (!active) {
            const state = await detectFacebookState(page).catch(() => "UNKNOWN");
            result.outcome = state === "BANNED" ? "banned" : "inactive";
            result.error = `Facebook state: ${state}`;
            return result;
        }
        const english = await ensureEnglish(page);
        result.english = english ? "OK" : "FAIL";
        if (!english) {
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
