import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import ensureFacebookAccountLoggedIn from "./ensureFacebookAccountLoggedIn.js";
import ensureFacebookAccountActive from "./ensureFacebookAccountActive.js";

// Відкриттям сторінки та закриттям браузера керує workflow, що викликає перевірку.
export default async function checkFacebookAfterLaunch({
    adsPower, profile, page, checks, signal, onCheck, onResult, actions = {},
    englishFailure = "stop",
}) {
    for (const key of ["loggedIn", "active", "ensureEnglish"]) {
        if (typeof checks?.[key] !== "boolean") {
            throw new TypeError(`Потрібно явно вказати checks.${key}`);
        }
    }
    if (!["stop", "continue"].includes(englishFailure)) {
        throw new TypeError("Некоректна політика englishFailure");
    }
    const result = { ok: true, failedCheck: null, login: null, active: null, english: null };
    const steps = [
        ["loggedIn", "login", () => (actions.ensureLoggedIn ?? ensureFacebookAccountLoggedIn)(adsPower, profile, page)],
        ["active", "active", () => (actions.ensureActive ?? ensureFacebookAccountActive)(adsPower, profile, page, { signal })],
        ["ensureEnglish", "english", () => (actions.ensureEnglish ?? ensureEnglish)(page)],
    ];
    for (const [check, field, run] of steps) {
        if (!checks[check]) continue;
        if (signal?.aborted) {
            throw Object.assign(new Error("Перевірку перервано"), { name: "AbortError" });
        }
        await onCheck?.(check);
        result[field] = Boolean(await run());
        await onResult?.(field, result[field]);
        if (!result[field] && !(check === "ensureEnglish" && englishFailure === "continue")) {
            result.ok = false;
            result.failedCheck = check;
            break;
        }
    }
    return result;
}
