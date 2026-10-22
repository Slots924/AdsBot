import puppeteer from "puppeteer-core";
import configureFacebookAutomationWindow from "../../facebook/browser/configureFacebookAutomationWindow.js";
import checkProfileBeforeLaunch from "./checkProfileBeforeLaunch.js";
import checkFacebookAfterLaunch from "./checkFacebookAfterLaunch.js";
import isProfileOpen from "../../services/profile/isProfileOpen.js";
import runFarmActions from "../../facebook/actions/runFarmActions.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";

const abortError = () => Object.assign(new Error("Фарм перервано"), { name: "AbortError" });

// Очікування обмежене, а пізнє завершення не може запустити наступний крок.
export function awaitFarmStage(operation, signal, onLate = () => {}) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? abortError());
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then((value) => {
            signal.removeEventListener("abort", abort);
            if (signal.aborted) Promise.resolve(onLate(value)).catch(() => {});
            else resolve(value);
        }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
    });
}

export async function boundedFarmCleanup(operation, milliseconds = 10000) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Перевищено час закриття профілю")), milliseconds); }),
        ]);
    } finally { clearTimeout(timer); }
}

export default async function executeFarmWithProfile({ adsPower, profile, settings, pool, signal: parentSignal,
    onFarmStart = async () => {}, onState = async () => {}, onEvent = async () => {}, dependencies = {} }) {
    const connect = dependencies.connect ?? ((options) => puppeteer.connect(options));
    const ready = dependencies.ready ?? checkProfileBeforeLaunch;
    const isOpen = dependencies.isOpen ?? isProfileOpen;
    const check = dependencies.check ?? checkFacebookAfterLaunch;
    const configure = dependencies.configure ?? configureFacebookAutomationWindow;
    const actions = dependencies.actions ?? runFarmActions;
    const cleanupMs = dependencies.cleanupMs ?? 10000;
    const profileNo = String(profile.profile_no);
    const controller = new AbortController();
    const signal = controller.signal;
    const result = { outcome: "failed", reason: null, farmStartedAt: null, farmFinishedAt: null, farmTimeMs: 0 };
    let browser;
    let opening = false;
    let timedOut = false;
    let timer;
    const cancel = () => controller.abort(parentSignal?.reason ?? abortError());
    parentSignal?.addEventListener("abort", cancel, { once: true });
    if (parentSignal?.aborted) cancel();
    const stage = (operation, onLate) => awaitFarmStage(operation, signal, onLate);
    const stopProfile = () => {
        const cleanupSignal = AbortSignal.timeout(cleanupMs);
        return boundedFarmCleanup(() => adsPower.closeProfile(profileNo, { signal: cleanupSignal, timeout: cleanupMs }), cleanupMs);
    };
    try {
        if (await stage(() => isOpen(adsPower, profile))) {
            result.outcome = "skipped"; result.reason = "Профіль уже відкритий або статус недоступний";
            return result;
        }
        const readiness = await stage(() => ready({ adsPower, profile, checks: { adsPowerReady: true, blockedTags: ["BAN", "LOGIN_ERROR"] } }));
        if (!readiness.ok) {
            await onState({ state: readiness.blockedTag === "BAN" ? "banned" : "not_ready", checkedAt: new Date().toISOString() });
            result.outcome = "check_failed"; result.reason = readiness.blockedTag ?? "Профіль не готовий";
            return result;
        }
        signal.throwIfAborted();
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort(Object.assign(new Error("Вичерпано таймаут акаунта"), { name: "TimeoutError" }));
        }, dependencies.timeoutMs ?? settings.timeoutSeconds * 1000);
        opening = true;
        const browserData = await stage(() => adsPower.openProfile(profileNo, {
            browserMode: settings.headless ? "headless" : "visible", disableImages: settings.disableImages,
            proxyDetection: true, restoreLastOpenedTabs: false, signal,
        }), stopProfile);
        browser = await stage(() => connect({ browserWSEndpoint: browserData.ws.puppeteer, defaultViewport: null }),
            (lateBrowser) => boundedFarmCleanup(() => lateBrowser.close(), cleanupMs).finally(() => lateBrowser.disconnect()));
        const page = await stage(async () => (await browser.pages())[0] ?? await browser.newPage());
        await stage(() => configure(page, { browserMode: settings.headless ? "headless" : "visible" }));
        await stage(() => page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60000 }));
        const checked = await stage(() => check({ adsPower, profile, page, signal,
            checks: { loggedIn: true, active: true, ensureEnglish: true },
            onResult: async (field, passed) => onEvent({ action: `check_${field}`, status: passed ? "completed" : "failed" }),
        }));
        let state = checked.ok ? "working" : `failed_${checked.failedCheck}`;
        if (checked.failedCheck === "active") {
            const detected = await stage(() => (dependencies.detectState ?? detectFacebookState)(page));
            if (detected === "BANNED") state = "banned";
        }
        await stage(() => onState({ state, checkedAt: new Date().toISOString() }));
        if (!checked.ok) {
            result.outcome = "check_failed"; result.reason = checked.failedCheck;
            return result;
        }
        result.farmStartedAt = new Date().toISOString();
        await stage(() => onFarmStart(result.farmStartedAt));
        let failed = false;
        await stage(() => actions(page, { settings, pool, signal, log: async (event) => {
            signal.throwIfAborted();
            if (event.status === "failed") failed = true;
            await onEvent(event);
        } }));
        result.outcome = failed ? "failed" : "completed";
    } catch (error) {
        result.outcome = timedOut ? "timeout" : signal.aborted ? "cancelled" : "failed";
        result.reason = timedOut ? "Вичерпано таймаут акаунта" : signal.aborted ? "Скасовано" : error.message;
    } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener("abort", cancel);
        if (result.farmStartedAt) {
            result.farmFinishedAt = new Date().toISOString();
            result.farmTimeMs = Math.max(0, Date.parse(result.farmFinishedAt) - Date.parse(result.farmStartedAt));
        }
        if (browser) {
            try {
                // Закриваємо транспорт браузера, щоб незавершені DOM-дії не продовжували виконання.
                if (signal.aborted) await boundedFarmCleanup(() => browser.close(), cleanupMs);
            } catch (error) { result.cleanupError = error.message; }
            finally { try { browser.disconnect(); } catch {} }
        }
        if (opening) {
            try { await stopProfile(); }
            catch (error) { result.cleanupError = error.message; }
        }
    }
    return result;
}
