import { accountRecovery } from "../selectors/accountRecovery.js";

// Функція виконується в браузері; значення полів та довільні тексти не повертаються.
export function inspectRecoveryInPage(config, action = null) {
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const visible = (element) => {
        if (!element?.isConnected || element.closest('[data-adsbot-recovery-prompt]')) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none"
            && style.visibility !== "hidden" && style.opacity !== "0"
            // ARIA батьків описує доступність, але не приховує видиму кнопку від миші.
            && element.getAttribute("aria-hidden") !== "true"
            && !element.closest("[inert]");
    };
    const enabled = (element) => visible(element) && !element.disabled
        && element.getAttribute("aria-disabled") !== "true";
    const all = (selector, root = document) => [...root.querySelectorAll(selector)];
    const textMatches = (element, labels) => labels.some((label) =>
        normalize(element.getAttribute("aria-label")) === normalize(label)
        || normalize(element.innerText || element.textContent || element.value) === normalize(label));
    const dialogs = all(config.dialog).filter(visible);
    const protection = dialogs.find((element) => normalize(element.innerText).includes(normalize(config.protectionText)));
    const root = protection ?? document;
    const controls = all(config.controls, root);
    const findControl = (name) => controls.find((element) => enabled(element) && textMatches(element, config.labels[name]));
    const bodyText = normalize(document.body?.innerText);
    const heading = (name) => config.headings[name].some((text) => bodyText.includes(normalize(text)));
    const url = new URL(location.href);
    const validHost = ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname);
    const methodHeading = all('h1, h2, [role="heading"], span').find((element) =>
        visible(element) && textMatches(element, config.headings.recoveryMethod));
    const lockedPath = /^\/checkpoint\/828281030927956\/?$/.test(url.pathname);
    const recoveryPath = /^\/(checkpoint|recover)(\/|\.|$)/i.test(url.pathname);
    const recoveryContext = validHost && (lockedPath || (recoveryPath && Boolean(methodHeading)));
    // Збираємо всі видимі методи до аналізу заголовка, щоб не втратити email в іншій гілці DOM.
    const methodControls = controls.filter((element) => visible(element)
        && config.recoveryMethods.some((name) => textMatches(element, config.labels[name])));
    const visibleMethods = config.recoveryMethods.filter((name) => methodControls.some((element) =>
        visible(element) && textMatches(element, config.labels[name])));
    const availableMethods = recoveryContext ? visibleMethods : [];
    const emailAvailable = recoveryContext && methodControls.some((element) => enabled(element) && textMatches(element, config.labels.email));
    const loading = all('[aria-busy="true"], [role="progressbar"]').some(visible);
    const passwords = all('input[type="password"]').filter(enabled);
    const radios = all('input[type="radio"]').filter((element) => enabled(element) && String(element.value).includes("@"));
    const codeInputs = all('input[type="text"], input[type="tel"], input[type="number"]').filter(enabled);
    const blockedPath = /^\/(checkpoint|login|recover|confirmemail|two_step_verification|auth_platform|accounts\/login)(\/|\.|$)/i.test(url.pathname);
    const hasLogin = all(config.login).some(visible);
    const authenticated = validHost && !blockedPath && !hasLogin && passwords.length === 0
        && all(config.authenticated).some(visible)
        && all('[role="main"], [role="navigation"]').some(visible);
    let step = "UNKNOWN";
    if (!validHost) step = "OFFSITE";
    else if (protection) step = "PROTECTION_DIALOG";
    else if (heading("newPassword") && passwords.length) step = "NEW_PASSWORD";
    else if (heading("currentPassword") && passwords.length) step = "CURRENT_PASSWORD";
    else if (heading("code") && codeInputs.length) step = "CONFIRMATION_CODE";
    else if (recoveryContext && availableMethods.length) step = "CHOOSE_RECOVERY_METHOD";
    else if (findControl("start")) step = "GET_STARTED";
    else if (findControl("email")) step = "CHOOSE_EMAIL";
    else if (radios.length && findControl("next")) step = "EMAIL_CONTACT";
    else if (radios.length) step = "EMAIL_CONTACT";
    else if (authenticated) step = "AUTHENTICATED";
    else if (hasLogin) step = "LOGIN";
    if (action) {
        if (action === "password") return passwords.length === 1 ? passwords[0] : null;
        if (action === "code") return codeInputs.length === 1 ? codeInputs[0] : null;
        if (action === "radio") return radios.length === 1 ? radios[0] : null;
        if (action === "email" && recoveryContext) return methodControls.find((element) =>
            enabled(element) && textMatches(element, config.labels.email)) ?? null;
        return findControl(action) ?? null;
    }
    const summarize = (name) => {
        const matches = controls.filter((element) => textMatches(element, config.labels[name]));
        return {
            total: matches.length, visible: matches.filter(visible).length, enabled: matches.filter(enabled).length,
            candidates: matches.slice(0, 10).map((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                const blockedBy = [];
                if (!element.isConnected) blockedBy.push("disconnected");
                if (element.closest('[data-adsbot-recovery-prompt]')) blockedBy.push("manual_prompt");
                if (rect.width <= 0 || rect.height <= 0) blockedBy.push("zero_size");
                if (style.display === "none") blockedBy.push("display_none");
                if (style.visibility === "hidden") blockedBy.push("visibility_hidden");
                if (style.opacity === "0") blockedBy.push("opacity_zero");
                if (element.getAttribute("aria-hidden") === "true") blockedBy.push("own_aria_hidden");
                if (element.closest("[inert]")) blockedBy.push("inert");
                if (element.disabled || element.getAttribute("aria-disabled") === "true") blockedBy.push("disabled");
                return {
                    tag: element.tagName?.toLowerCase() ?? null, role: element.getAttribute("role"),
                    width: Math.round(rect.width), height: Math.round(rect.height),
                    display: style.display, visibility: style.visibility, opacity: style.opacity,
                    ancestorAriaHidden: Boolean(element.parentElement?.closest('[aria-hidden="true"]')),
                    blockedBy,
                };
            }),
        };
    };
    return {
        step, hostname: url.hostname, pathname: url.pathname, readyState: document.readyState,
        authenticated, protectionDialog: Boolean(protection), dialogCount: dialogs.length,
        availableMethods, emailAvailable, loading,
        methodDiagnostics: {
            recoveryContext, lockedPath, headingMatched: Boolean(methodHeading), visibleMethods,
            reason: !recoveryContext ? "RECOVERY_CONTEXT_MISSING"
                : !visibleMethods.length ? "RECOVERY_METHODS_NOT_FOUND"
                    : loading ? "RECOVERY_SCREEN_LOADING" : null,
        },
        passwordInputCount: passwords.length, codeInputCount: codeInputs.length,
        emailContactCount: radios.length, emailSelected: radios.some((element) => element.checked),
        codeRejected: config.codeErrors.some((text) => bodyText.includes(normalize(text))),
        passwordRejected: config.passwordErrors.some((text) => bodyText.includes(normalize(text))),
        controls: Object.fromEntries(Object.keys(config.labels).map((name) => [name, summarize(name)])),
    };
}

export default async function detectAccountRecoveryStep(page) {
    return page.evaluate(inspectRecoveryInPage, accountRecovery);
}
