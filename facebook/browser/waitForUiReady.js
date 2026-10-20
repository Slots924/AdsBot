import { randomUUID } from "node:crypto";
import { getBrowserTrace } from "../../services/logging/browserTraceContext.js";

// Відстежуємо саме цільовий вузол: зміни у стрічці не блокують готову кнопку.
export function uiReadyInPage(selector, { token, stableMs, requireEnabled, expectedText = null, firstLine = false, textMatch = "exact" }) {
    const key = Symbol.for("adsbot.uiReady");
    const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return node.isConnected && rect.width > 0 && rect.height > 0
            && style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
    const matches = (node) => {
        if (expectedText === null) return true;
        const raw = node.matches?.('input[type="radio"]')
            ? node.parentElement?.parentElement?.parentElement?.innerText
            : node.innerText ?? node.textContent;
        const actual = firstLine ? String(raw ?? "").split(/\r?\n/)[0] : raw;
        return textMatch === "includes" ? normalize(actual).includes(normalize(expectedText))
            : normalize(actual) === normalize(expectedText);
    };
    const node = [...document.querySelectorAll(selector)].find((candidate) => visible(candidate) && matches(candidate));
    const region = node?.closest('[role="dialog"], [role="alertdialog"]') ?? node;
    const blocked = !node || document.readyState === "loading"
        || node.closest('[aria-busy="true"], [inert]')
        || [...(region?.querySelectorAll('[aria-busy="true"], [role="progressbar"]') ?? [])].some(visible)
        || (requireEnabled && (node.disabled || node.getAttribute("aria-disabled") === "true"
            || node.closest('[aria-disabled="true"], button:disabled')));
    if (blocked) { document[key] = null; return false; }
    const rect = node.getBoundingClientRect();
    const fingerprint = [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width),
        Math.round(rect.height), node.childElementCount, node.getAttribute("aria-disabled"),
        node.getAttribute("aria-expanded"), node.textContent?.slice(0, 500)].join("|");
    const previous = document[key];
    if (!previous || previous.token !== token || previous.node !== node || previous.fingerprint !== fingerprint) {
        document[key] = { token, node, fingerprint, since: Date.now() };
        return false;
    }
    return Date.now() - previous.since >= stableMs;
}

export default async function waitForUiReady(page, selector, {
    timeout = 90000, stableMs = 180, requireEnabled = true,
    expectedText = null, firstLine = false, textMatch = "exact",
} = {}) {
    if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(stableMs) || stableMs < 0) {
        throw new RangeError("Некоректні параметри очікування UI");
    }
    const trace = getBrowserTrace(page);
    await trace?.event("wait.started", { selector, expected: "видимий стабільний елемент" });
    let handle;
    try {
        handle = await page.waitForFunction(uiReadyInPage, { timeout, polling: 50 }, selector, {
            token: randomUUID(), stableMs: Math.min(stableMs, timeout / 3), requireEnabled, expectedText, firstLine, textMatch,
        });
        await trace?.observe(page, { point: "ui-ready", selector });
    } catch (error) {
        await trace?.failure(page, { point: "ui-timeout", selector, error });
        throw error;
    } finally {
        await handle?.dispose?.().catch(() => {});
    }
}
