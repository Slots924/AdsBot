import { waitRecoveryCondition, emitRecoveryStep } from "./recoveryControls.js";

const promptSelector = '[data-adsbot-recovery-prompt]';

export default async function requestRecoveryValue({ page, kind = "code", retry = false, signal, onStep, manualTimeout = 300000 }) {
    const options = { signal, onStep };
    await page.bringToFront();
    await page.evaluate((selector, fieldKind, repeated) => {
        document.querySelector(selector)?.remove();
        const host = document.createElement("div");
        host.setAttribute("data-adsbot-recovery-prompt", "");
        host.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0009";
        const shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `<style>form{background:white;color:#222;padding:28px;border-radius:12px;font:16px system-ui;width:360px}input{box-sizing:border-box;width:100%;padding:12px;margin:16px 0}button{padding:10px;margin-right:10px}</style><form><h3></h3><p></p><input required autocomplete="off"><button type="submit">Продовжити</button><button type="button">Скасувати</button></form>`;
        shadow.querySelector("h3").textContent = fieldKind === "code" ? "AdsBot: код підтвердження" : "AdsBot: новий пароль Facebook";
        shadow.querySelector("p").textContent = repeated ? "Facebook відхилив код. Введіть актуальний код." : "Значення використовується лише для цієї операції та не потрапляє в журнал.";
        const input = shadow.querySelector("input");
        input.type = fieldKind === "code" ? "text" : "password";
        if (fieldKind === "code") input.inputMode = "numeric";
        host.recoveryResult = null;
        shadow.querySelector("form").addEventListener("submit", (event) => {
            event.preventDefault();
            host.recoveryResult = { value: input.value, cancelled: false };
            input.value = "";
        });
        shadow.querySelector('button[type="button"]').addEventListener("click", () => {
            host.recoveryResult = { cancelled: true };
            input.value = "";
        });
        document.documentElement.append(host);
        input.focus();
    }, promptSelector, kind, retry);
    await emitRecoveryStep(options, "manual.open", { kind, retry, timeout: manualTimeout });
    try {
        await waitRecoveryCondition(page, () => page.evaluate((selector) => {
            const host = document.querySelector(selector);
            return !host || Boolean(host.recoveryResult);
        }, promptSelector), options, "ручне введення", manualTimeout);
        const result = await page.evaluate((selector) => document.querySelector(selector)?.recoveryResult, promptSelector);
        if (!result || result.cancelled) throw Object.assign(new Error("Ручне введення скасовано"), { name: "AbortError", code: "MANUAL_CANCELLED" });
        return kind === "code" ? result.value.trim() : result.value;
    } finally {
        await page.evaluate((selector) => document.querySelector(selector)?.remove(), promptSelector).catch(() => {});
        await emitRecoveryStep(options, "manual.closed", { kind });
    }
}
