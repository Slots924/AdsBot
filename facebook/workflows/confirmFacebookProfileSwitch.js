import captureGraphqlPayload from "../api-actions/captureGraphqlPayload.js";


export const confirmFacebookProfileSwitchStatuses = Object.freeze({
    PROFILE_SWITCH_CONFIRMED: "PROFILE_SWITCH_CONFIRMED",
    INVALID_INPUT: "INVALID_INPUT",
    BRING_TO_FRONT_FAILED: "BRING_TO_FRONT_FAILED",
    RELOAD_FAILED: "RELOAD_FAILED",
    PAYLOAD_CAPTURE_FAILED: "PAYLOAD_CAPTURE_FAILED",
    ACTOR_MISMATCH: "ACTOR_MISMATCH",
    ERROR: "ERROR",
});


function createResult(success, status, data = null, extra = {}) {
    return { success, status, data, ...extra };
}


// Підтверджує switch лише за свіжим payload після примусового перемальовування UI.
export default async function confirmFacebookProfileSwitch({
    page,
    targetProfileId,
    profileUrl = "https://www.facebook.com/me",
    timeout = 60000,
}) {
    const normalizedTargetProfileId = String(targetProfileId ?? "").trim();
    if (!page || typeof page.bringToFront !== "function" || typeof page.reload !== "function"
        || !normalizedTargetProfileId) {
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

    try {
        await page.reload({ waitUntil: "domcontentloaded", timeout });
    } catch (error) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.RELOAD_FAILED, null, {
            error: String(error?.message ?? error),
        });
    }

    const captured = await captureGraphqlPayload(page, { profileUrl, timeout });
    if (!captured.success) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.PAYLOAD_CAPTURE_FAILED, null, {
            error: captured.error ?? captured.status,
            captureStatus: captured.status,
        });
    }

    const actorId = String(captured.data?.__user ?? "");
    if (actorId !== normalizedTargetProfileId) {
        return createResult(false, confirmFacebookProfileSwitchStatuses.ACTOR_MISMATCH, null, {
            error: "Facebook actor не відповідає вибраній фанпейджі після перемикання",
            actorId,
            targetProfileId: normalizedTargetProfileId,
        });
    }

    return createResult(true, confirmFacebookProfileSwitchStatuses.PROFILE_SWITCH_CONFIRMED, {
        payload: captured.data,
        actorId,
    });
}
