import { waitForDomQuiet } from "../browser/confirmedClick.js";
import {
    getFirstVisibleElement,
    waitForVisibleElement,
} from "../browser/elements.js";
import { humanClickElement } from "../browser/pointer.js";
import { wait } from "../browser/timing.js";


// Підтверджує пароль лише тоді, коли Facebook уже показав mini-auth форму.
// Пароль не повертається з browser context і не повинен логуватися caller-ом.
export default async function reauthFacebookPassword(page, password, { timeout = 15000 } = {}) {
    const normalizedPassword = String(password ?? "");
    if (!page || typeof page.$ !== "function" || !normalizedPassword) {
        return { success: false, status: "INVALID_INPUT" };
    }

    const selector = 'input[type="password"], input[name="password"], input[name="pass"]';
    const initialInput = await waitForVisibleElement(page, selector, { timeout }).catch(() => null);
    if (!initialInput) return { success: true, status: "NOT_REQUIRED" };
    await initialInput.dispose();
    await waitForDomQuiet(page, { selector }, {
        quietMs: 300,
        timeout: Math.min(timeout, 5000),
    });

    const input = await getFirstVisibleElement(page, selector);
    if (!input) return { success: false, status: "PASSWORD_INPUT_DISAPPEARED" };
    try {
        await humanClickElement(page, input);
        await page.keyboard.down("Control");
        await page.keyboard.press("A");
        await page.keyboard.up("Control");
        await input.type(normalizedPassword, { delay: 35 });
    } finally {
        await input.dispose();
    }

    const submitSelector = 'button[type="submit"], [role="button"][aria-label*="Confirm" i], [role="button"][aria-label*="Continue" i]';
    const initialSubmit = await waitForVisibleElement(page, submitSelector, { timeout }).catch(() => null);
    if (!initialSubmit) return { success: false, status: "SUBMIT_NOT_FOUND" };
    await initialSubmit.dispose();
    await waitForDomQuiet(page, { selector: submitSelector }, {
        quietMs: 300,
        timeout: Math.min(timeout, 5000),
    });
    const submit = await getFirstVisibleElement(page, submitSelector);
    if (!submit) return { success: false, status: "SUBMIT_NOT_FOUND" };
    try {
        await humanClickElement(page, submit);
    } finally {
        await submit.dispose();
    }
    await page.waitForFunction(
        (passwordSelector) => !document.querySelector(passwordSelector),
        { timeout },
        selector
    ).catch(() => {});
    await wait(300);
    const stillVisible = await getFirstVisibleElement(page, selector);
    await stillVisible?.dispose();
    return stillVisible
        ? { success: false, status: "REAUTH_NOT_CONFIRMED" }
        : { success: true, status: "REAUTHENTICATED" };
}
