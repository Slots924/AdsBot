import { readFacebookRuntime } from "../api/runtime.js";


export const confirmFacebookProfileSwitchStatuses = Object.freeze({
    PROFILE_SWITCH_CONFIRMED: "PROFILE_SWITCH_CONFIRMED",
    INVALID_INPUT: "INVALID_INPUT",
    BRING_TO_FRONT_FAILED: "BRING_TO_FRONT_FAILED",
    RUNTIME_UNAVAILABLE: "RUNTIME_UNAVAILABLE",
    ACTOR_MISMATCH: "ACTOR_MISMATCH",
    ERROR: "ERROR",
});


function createResult(success, status, data = null, extra = {}) {
    return { success, status, data, ...extra };
}


// Підтверджує actor лише після оновлення сторінки та читання нового runtime.
export default async function confirmFacebookProfileSwitch({
    page,
    targetProfileId,
    profileUrl = "https://www.facebook.com/me",
    timeout = 60000,
}) {
    const normalizedTargetProfileId = String(targetProfileId ?? "").trim();
    if (!page || typeof page.bringToFront !== "function" || !normalizedTargetProfileId) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.INVALID_INPUT, null, {
            error: "Потрібні Puppeteer page та Additional profile ID",
        });
    }

    try {
        await page.bringToFront();
    } catch (error) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.BRING_TO_FRONT_FAILED, null, {
            error: String(error?.message ?? error),
        });
    }

    // Після switch старий JS-контекст може ще належати попередньому actor.
    try {
        const target = new URL(profileUrl);
        if (target.protocol !== "https:" || !["www.facebook.com", "facebook.com"].includes(target.hostname)) {
            throw new Error("Некоректна сторінка підтвердження Facebook actor");
        }
        await page.goto(target.href, { waitUntil: "domcontentloaded", timeout });
    } catch {
        return createResult(false, confirmFacebookProfileSwitchStatuses.ERROR, null, {
            error: "Не вдалося оновити сторінку після перемикання Facebook actor",
        });
    }
    const runtime = await readFacebookRuntime(page, { timeout });
    if (runtime.runtimeError) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.RUNTIME_UNAVAILABLE, null, {
            error: runtime.runtimeError,
        });
    }
    const actorId = String(runtime.av ?? runtime.__user ?? "");
    if (actorId !== normalizedTargetProfileId) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.ACTOR_MISMATCH, null, {
            error: "Facebook actor не відповідає вибраній фанпейджі після перемикання",
            actorId,
            targetProfileId: normalizedTargetProfileId,
        });
    }

    return createResult(true, confirmFacebookProfileSwitchStatuses.PROFILE_SWITCH_CONFIRMED, {
        actorId,
    });
}
