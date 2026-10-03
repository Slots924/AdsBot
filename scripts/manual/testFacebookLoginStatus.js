import "dotenv/config";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import detectLoginStatus from "../../facebook/state/detectLoginStatus.js";
import ensureLogin from "../../facebook/state/ensureLogin.js";
import detectFacebookState from "../../facebook/state/detectFacebookState.js";
import detectAccountRecoveryStep from "../../facebook/state/detectAccountRecoveryStep.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import { getFacebookCredentials, getFirstmailCredentials } from "../../services/adspower/profileCredentials.js";
import readRecoveryPassword from "../../services/adspower/recoveryPassword.js";
import describeRecoveryEvent from "../../services/logging/describeRecoveryEvent.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const profileNo = String(process.argv[2] ?? "2244").trim();
const observationMs = Number(process.argv[3] ?? 90000);
const started = Date.now();
const logDirectory = path.join(root, "data", "logs", "manual-recovery");
mkdirSync(logDirectory, { recursive: true });
const logFile = path.join(logDirectory, `${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const secrets = new Set();
let sequence = 0;

function sanitize(value) {
    if (typeof value === "string") {
        let text = value;
        for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.split(secret).join("[REDACTED]");
        return text.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").replace(/https?:\/\/[^\s]+/g, (address) => {
            try { const url = new URL(address); return `${url.origin}${url.pathname}`; } catch { return "[URL]"; }
        });
    }
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
        [key, /^(password|login|username|login_user|fakey|twoFactorKey|value|cookie|authorization|firstmailCredentials)$/i.test(key)
            ? "[REDACTED]" : sanitize(item)]));
    return value;
}

function log(event, details = {}) {
    if (event === "pointer.event" || event === "browser.console.issue") return;
    const { elapsedMs: operationElapsedMs, ...remaining } = details;
    const entry = sanitize({ ...remaining, sequence: ++sequence, timestamp: new Date().toISOString(),
        elapsedMs: Date.now() - started, event,
        ...(operationElapsedMs === undefined ? {} : { operationElapsedMs }),
    });
    const line = JSON.stringify(entry);
    console.log(`[+${(entry.elapsedMs / 1000).toFixed(1)}с] ${describeRecoveryEvent(event, entry)}`);
    appendFileSync(logFile, `${line}\n`, "utf8");
}

function safeLocation(address) {
    try { const url = new URL(address); return { hostname: url.hostname, pathname: url.pathname }; }
    catch { return { hostname: "unknown" }; }
}

async function main() {
    if (!/^\d+$/.test(profileNo) || !Number.isFinite(observationMs) || observationMs <= 0) {
        throw new Error("Вкажіть номер профілю та додатний час спостереження в мілісекундах");
    }
    const adsPower = new AdsPower();
    const controller = new AbortController();
    const onInterrupt = () => { log("task.cancel.requested"); controller.abort(); };
    process.once("SIGINT", onInterrupt);
    let browser;
    let timer;
    let inspecting = false;
    let pendingInspection = Promise.resolve();
    let previousSnapshot = "";
    let finalRecoveryResult = null;
    const listeners = [];
    try {
        log("test.start", { profileNo, observationMs, logFile, actionTimeout: 60000, codeTimeout: 60000, codeProvider: "Firstmail IMAP" });
        const profile = await adsPower.getProfileByNo(profileNo);
        const newPassword = await readRecoveryPassword();
        if (newPassword) secrets.add(newPassword);
        for (const account of profile.platform_account ?? []) {
            for (const value of [account.login_user, account.password, account.fakey]) if (value) secrets.add(value);
        }
        for (const value of [profile.username, profile.password, profile.fakey, process.env.FACEBOOK_RECOVERY_NEW_PASSWORD]) if (value) secrets.add(value);
        let facebook;
        let firstmail;
        try { facebook = getFacebookCredentials(profile); } catch { log("profile.facebook.credentials.incomplete"); }
        try { firstmail = getFirstmailCredentials(profile); } catch { log("profile.firstmail.credentials.incomplete"); }
        log("profile.credentials.checked", { facebookAvailable: Boolean(facebook), firstmailAvailable: Boolean(firstmail), platformCount: profile.platform_account?.length ?? 0 });
        log("browser.open.start");
        const browserData = await adsPower.openProfile(profileNo, { browserMode: "visible" });
        browser = await puppeteer.connect({ browserWSEndpoint: browserData.ws.puppeteer, defaultViewport: null });
        const pages = await browser.pages();
        const page = pages.find((candidate) => ["facebook.com", "www.facebook.com"].includes(safeLocation(candidate.url()).hostname))
            ?? pages[0] ?? await browser.newPage();
        const listen = (event, callback) => { page.on(event, callback); listeners.push(() => page.off(event, callback)); };
        listen("framenavigated", (frame) => { if (frame === page.mainFrame()) log("browser.navigation", safeLocation(frame.url())); });
        listen("domcontentloaded", () => log("browser.domcontentloaded"));
        listen("load", () => log("browser.load"));
        listen("close", () => { log("browser.page.closed"); controller.abort(); });
        listen("pageerror", (error) => log("browser.javascript.error", { errorType: error.name }));
        listen("console", (message) => {
            if (["error", "warning"].includes(message.type())) log("browser.console.issue", { type: message.type() });
        });
        listen("requestfailed", (request) => {
            if (["document", "xhr", "fetch"].includes(request.resourceType())) {
                log("network.failed", { ...safeLocation(request.url()), resourceType: request.resourceType(), failure: request.failure()?.errorText });
            }
        });
        listen("response", (response) => {
            if ((response.status() >= 400 && ["document", "xhr", "fetch"].includes(response.request().resourceType())) || response.request().isNavigationRequest()) {
                log("network.response", { ...safeLocation(response.url()), status: response.status(), resourceType: response.request().resourceType() });
            }
        });
        await configureFacebookAutomationWindow(page, { browserMode: "visible" });
        await openPageWithoutPopups(page, "https://www.facebook.com/", { timeout: 60000 });
        const inspect = async (reason) => {
            if (inspecting || page.isClosed()) return;
            inspecting = true;
            try {
                const snapshot = await detectAccountRecoveryStep(page);
                const signature = snapshot.step;
                if (signature !== previousSnapshot) log("state.observed", { step: snapshot.step });
                previousSnapshot = signature;
            } catch (error) { log("dom.inspect.failed", { errorType: error.name }); }
            finally { inspecting = false; }
        };
        await inspect("initial");
        timer = setInterval(() => { if (!inspecting) pendingInspection = inspect("interval"); }, 3000);
        const stateBeforeLogin = await detectFacebookState(page);
        log("login.check.start", { stateBeforeLogin, detectedLoginStatus: await detectLoginStatus(page) });
        if (stateBeforeLogin !== "ACCOUNT_LOCK") {
            const loginSucceeded = await ensureLogin(page, { timeout: 60000 });
            log("login.check.complete", { loginSucceeded });
        } else log("login.check.checkpoint", { reason: "Переходимо до recovery на поточній вкладці" });
        const state = await detectFacebookState(page);
        log("account.check.start", { state });
        if (state === "ACCOUNT_LOCK") {
            const active = await ensureFacebookAccountActive(adsPower, profile, page, {
                timeout: 60000, codeTimeout: 60000, manualTimeout: 300000, signal: controller.signal,
                newPassword,
                onStep: log,
                onRecoveryResult: (result) => { finalRecoveryResult = result; log("recovery.result", result); },
            });
            log("account.check.complete", { active });
            if (!active) process.exitCode = 1;
        } else {
            log("account.check.complete", { active: state === "READY", recoveryNeeded: false, state });
            if (state !== "READY") process.exitCode = 1;
        }
        await inspect("after_workflow");
        log("observation.start", { observationMs, hint: "Enter завершує спостереження; Ctrl+C скасовує recovery" });
        if (!controller.signal.aborted) await new Promise((resolve) => {
            const finish = () => {
                clearTimeout(timeout);
                process.stdin.off("data", finish);
                process.stdin.pause();
                controller.signal.removeEventListener("abort", finish);
                resolve();
            };
            const timeout = setTimeout(finish, observationMs);
            process.stdin.once("data", finish);
            controller.signal.addEventListener("abort", finish, { once: true });
            process.stdin.resume();
        });
        await inspect("final");
        log("test.complete", { recovery: finalRecoveryResult, aborted: controller.signal.aborted, exitCode: process.exitCode ?? 0 });
    } catch (error) {
        log("test.failed", { errorType: error.name, code: error.code ?? null, message: error.message });
        process.exitCode = 1;
    } finally {
        clearInterval(timer);
        await pendingInspection;
        for (const remove of listeners) remove();
        process.off("SIGINT", onInterrupt);
        browser?.disconnect();
        log("browser.disconnected", { profileLeftOpen: Boolean(browser), profileNo });
    }
}

main().catch((error) => { log("test.failed", { errorType: error.name, message: error.message }); process.exitCode = 1; });
