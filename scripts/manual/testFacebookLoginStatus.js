import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import detectLoginStatus from "../../facebook/state/detectLoginStatus.js";
import ensureLogin from "../../facebook/state/ensureLogin.js";
import {
    createNewAccountSelector,
    logInButtonSelector,
    useAnotherProfileSelector,
} from "../../facebook/selectors/login.js";


const defaultProfileNo = "1726";
const defaultObservationMs = 90000;
const observationIntervalMs = 3000;


function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}


function readArguments() {
    const values = process.argv.slice(2);
    const profileNo = String(values[0] ?? defaultProfileNo).trim();
    const observationMs = parsePositiveInteger(values[1], defaultObservationMs);

    if (!profileNo) {
        throw new Error("Вкажіть номер AdsPower-профілю");
    }

    return { profileNo, observationMs };
}


function log(step, details = null) {
    const suffix = details ? ` ${JSON.stringify(details, null, 2)}` : "";
    console.log(`[LOGIN-STATUS-TEST] ${step}${suffix}`);
}


async function inspectLoginDom(page) {
    return page.evaluate((selectors) => {
        const isVisible = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        };
        const describe = (element) => ({
            tag: element.tagName.toLowerCase(),
            type: element.getAttribute("type"),
            role: element.getAttribute("role"),
            name: element.getAttribute("name"),
            id: element.id || null,
            ariaLabel: element.getAttribute("aria-label"),
            placeholder: element.getAttribute("placeholder"),
            visible: isVisible(element),
            disabled: element.disabled === true,
            text: (element.innerText || element.textContent || "")
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 180),
        });
        const visible = (selector) => [...document.querySelectorAll(selector)]
            .filter(isVisible)
            .map(describe);
        const passwordInputs = visible('input[type="password"]');
        const identifierInputs = visible([
            'input[type="email"]',
            'input[type="text"][name="email"]',
            'input[autocomplete="username"]',
            'input[autocomplete="email"]',
        ].join(", "));
        const dialogs = visible('[role="dialog"]');
        const loginControls = visible([
            selectors.logInButton,
            'button[type="submit"]',
            'input[type="submit"]',
        ].join(", "));
        const bodyText = (document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .slice(0, 1200);

        return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            passwordInputs,
            identifierInputs,
            createNewAccount: visible(selectors.createNewAccount),
            useAnotherProfile: visible(selectors.useAnotherProfile),
            loginControls,
            dialogs: dialogs.map((dialog) => ({
                ...dialog,
                text: dialog.text.slice(0, 500),
            })),
            bodyText,
        };
    }, {
        createNewAccount: createNewAccountSelector,
        useAnotherProfile: useAnotherProfileSelector,
        logInButton: logInButtonSelector,
    });
}


function decideStatus(snapshot, legacyStatus) {
    const hasPasswordInput = snapshot.passwordInputs.length > 0;
    const hasIdentifierInput = snapshot.identifierInputs.length > 0;
    const hasLoginControl = snapshot.loginControls.length > 0;
    const hasCreateAccount = snapshot.createNewAccount.length > 0;
    const hasAccountPicker = snapshot.useAnotherProfile.length > 0;
    const hasLoginForm = hasPasswordInput || (hasIdentifierInput && hasLoginControl);

    if (hasLoginForm) {
        return {
            status: "LOGIN_FORM_VISIBLE",
            reason: "Є видиме поле пароля або повна форма входу; авторизацію не можна вважати підтвердженою.",
        };
    }
    if (hasAccountPicker) {
        return {
            status: "ACCOUNT_PICKER_VISIBLE",
            reason: "Facebook показує вибір профілю; це не доказ активної сесії потрібного акаунта.",
        };
    }
    if (hasCreateAccount) {
        return {
            status: "LOGGED_OUT_UI_VISIBLE",
            reason: "Видно елемент сторінки входу «Create new account».",
        };
    }
    if (legacyStatus === "LOGGED_IN") {
        return {
            status: "NO_LOGIN_UI_DETECTED",
            reason: "Старий детектор не знайшов Create new account, але це лише непряма ознака — перевірку треба трактувати обережно.",
        };
    }
    return {
        status: "UNKNOWN",
        reason: "Ознаки входу й активної сесії суперечливі або недостатні.",
    };
}


async function waitForExitOrTimeout(timeoutMs) {
    log("Спостереження триває. Натисніть Enter, щоб завершити раніше.", {
        timeoutMs,
        intervalMs: observationIntervalMs,
    });

    process.stdin.setEncoding("utf8");
    process.stdin.resume();

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            process.stdin.pause();
            resolve("timeout");
        }, timeoutMs);
        process.stdin.once("data", () => {
            clearTimeout(timeout);
            process.stdin.pause();
            resolve("enter");
        });
    });
}


async function main() {
    const { profileNo, observationMs } = readArguments();
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    try {
        log("Початок діагностики", { profileNo, observationMs });
        const profile = await adsPower.getProfileByNo(profileNo);
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode: "visible" });
        await openPageWithoutPopups(page, "https://www.facebook.com/", {
            timeout: 60000,
        });

        const startedAt = Date.now();
        let attempt = 0;
        const inspect = async () => {
            attempt += 1;
            const [snapshot, legacyStatus] = await Promise.all([
                inspectLoginDom(page),
                detectLoginStatus(page),
            ]);
            const decision = decideStatus(snapshot, legacyStatus);
            log("Знімок DOM", {
                attempt,
                elapsedMs: Date.now() - startedAt,
                profileNo: profile.profile_no,
                legacyStatus,
                decision,
                snapshot,
            });
        };

        await inspect();
        const interval = setInterval(() => {
            inspect().catch((error) => {
                log("Не вдалося зчитати DOM", { message: error.message });
            });
        }, observationIntervalMs);

        log("Запускаємо один реальний процес ensureLogin без повторної спроби й без тегування профілю");
        const loginSucceeded = await ensureLogin(page, { timeout: 60000 });
        log("Результат ensureLogin", { loginSucceeded });
        await inspect();

        const exitReason = await waitForExitOrTimeout(observationMs);
        clearInterval(interval);
        await inspect();
        log("Діагностику завершено", { exitReason });
    } catch (error) {
        console.error("[LOGIN-STATUS-TEST] ПОМИЛКА:", error.stack ?? error.message);
        process.exitCode = 1;
    } finally {
        browser?.disconnect();
        if (profileOpened) {
            log("Профіль залишено відкритим для ручного огляду", { profileNo });
        }
    }
}


main();
