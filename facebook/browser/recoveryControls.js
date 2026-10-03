import { humanClickElement } from "./pointer.js";
import { wait, waitHuman, randomInteger } from "./timing.js";
import { accountRecovery } from "../selectors/accountRecovery.js";
import { inspectRecoveryInPage } from "../state/detectAccountRecoveryStep.js";

export function throwIfRecoveryAborted(signal) {
    if (signal?.aborted) throw Object.assign(new Error("Відновлення скасовано"), { name: "AbortError", code: "RECOVERY_ABORTED" });
}

export async function emitRecoveryStep(options, event, details = {}) {
    if (typeof options.onStep === "function") {
        try { await options.onStep(event, details); } catch { /* Збій журналу не змінює результат операції. */ }
    } else console.log(`[FB-RECOVERY] ${event}`, details);
}

export async function waitRecoveryCondition(page, predicate, options, description, timeout = options.timeout ?? 60000) {
    const started = Date.now();
    let heartbeat = 0;
    await emitRecoveryStep(options, "wait.start", { description, timeout });
    while (Date.now() - started < timeout) {
        throwIfRecoveryAborted(options.signal);
        if (page.isClosed?.()) throw Object.assign(new Error("Вкладку закрито"), { code: "PAGE_CLOSED" });
        let value;
        try { value = await predicate(); } catch (error) {
            if (!/Execution context was destroyed|Cannot find context|detached Frame/i.test(error.message)) throw error;
        }
        if (value) {
            await emitRecoveryStep(options, "wait.complete", { description, elapsedMs: Date.now() - started });
            return value;
        }
        if (Date.now() - heartbeat >= 5000) {
            heartbeat = Date.now();
            await emitRecoveryStep(options, "wait.pending", { description, elapsedMs: Date.now() - started });
        }
        await wait(250, options);
    }
    await emitRecoveryStep(options, "wait.failed", { description, elapsedMs: Date.now() - started, timeout });
    throw Object.assign(new Error(`Перевищено час очікування: ${description}`), { code: "RECOVERY_TIMEOUT" });
}

async function freshControl(page, action, options) {
    await waitRecoveryCondition(page, async () => {
        const handle = await page.evaluateHandle(inspectRecoveryInPage, accountRecovery, action);
        const found = Boolean(handle.asElement());
        await handle.dispose();
        return found;
    }, options, `видимий активний ${action}`);
    await waitHuman("short", options);
    throwIfRecoveryAborted(options.signal);
    const handle = await page.evaluateHandle(inspectRecoveryInPage, accountRecovery, action);
    const element = handle.asElement();
    if (!element) { await handle.dispose(); throw new Error("Елемент змінився перед взаємодією"); }
    return element;
}

async function clickFreshElement(page, element, action, options) {
    const usable = await element.evaluate((target) => target.isConnected && !target.disabled
        && target.getAttribute("aria-disabled") !== "true" && target.getAttribute("aria-hidden") !== "true"
        && !target.closest("[inert]"));
    if (!usable) throw new Error("Елемент став неактивним перед кліком");
    await humanClickElement(page, element, {
        scrollDelay: [900, 1600], beforeDelay: [100, 260], holdDelay: [80, 170], ...options,
        onEvent: (details) => emitRecoveryStep(options, "pointer.event", { action, ...details }),
    });
}

export async function clickRecoveryControl(page, action, options = {}) {
    await emitRecoveryStep(options, "click.prepare", { action });
    const element = await freshControl(page, action, options);
    try {
        await clickFreshElement(page, element, action, options);
        await emitRecoveryStep(options, "click.complete", { action });
    } finally { await element.dispose().catch(() => {}); }
}

export async function typeRecoveryValue(page, action, value, options = {}) {
    if (typeof value !== "string" || !value) throw new Error("Порожнє значення для введення");
    const element = await freshControl(page, action, options);
    try {
        await clickFreshElement(page, element, action, options);
        await page.keyboard.down("Control");
        await page.keyboard.press("KeyA");
        await page.keyboard.up("Control");
        await page.keyboard.press("Backspace");
        for (const character of value) {
            throwIfRecoveryAborted(options.signal);
            await page.keyboard.type(character, { delay: randomInteger(60, 160, options) });
        }
        if (!await element.evaluate((target, expected) => target.isConnected && target.value === expected, value)) {
            throw Object.assign(new Error("Поле змінилося під час введення"), { code: "INPUT_VALUE_NOT_CONFIRMED" });
        }
    } finally { await element.dispose().catch(() => {}); }
    await emitRecoveryStep(options, "input.complete", { field: action });
}
