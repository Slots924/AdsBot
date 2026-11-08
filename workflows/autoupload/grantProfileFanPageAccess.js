import { withHttpWorkflow } from "../../services/reports/HttpExchangeTrace.js";
import grantFanPageAccess from "../../facebook/autoupload/workflows/grantFanPageAccess.js";
import checkProfileSession from "./checkProfileSession.js";
import { actionError, actionFailure } from "../../facebook/autoupload/graphql/errors.js";
import handleSessionFailure from "./handleSessionFailure.js";

// AdsPower залишається зовнішньою інтеграцією: Facebook-workflow отримує лише клієнт і пароль.
async function grantProfileFanPageAccessImpl({
    adsPower, profileId, profileNo, additionalProfileId, targetUserId, signal, onStage,
} = {}) {
    try {
        if ((!profileId && !profileNo) || (profileId && profileNo)
            || !/^[1-9]\d*$/.test(String(additionalProfileId ?? ""))
            || !/^[1-9]\d*$/.test(String(targetUserId ?? ""))) {
            return { ...actionFailure(actionError("Потрібен один профіль AdsPower та числові ID фанки й отримувача", "FACEBOOK_ACCESS_INPUT_INVALID")), stage: "VALIDATE" };
        }
        signal?.throwIfAborted();
        const profile = profileId ? await adsPower.getProfileById(profileId) : await adsPower.getProfileByNo(profileNo);
        const prepared = await checkProfileSession({ profileId: profile.profile_id, profile, adsPower, signal,
            onSessionStatus: result => handleSessionFailure({ result, adsPower, profile }) });
        if (!prepared.client) return { ...prepared.result, success: false, stage: "SESSION", outcome: "NOT_CONFIRMED",
            code: prepared.result.code ?? "FACEBOOK_SESSION_REQUIRED", message: prepared.result.message, sessionStatus: prepared.result.status,
            additionalProfileId, targetUserId, outcomeUnknown: false,
        };
        const result = await grantFanPageAccess(prepared.client, { additionalProfileId, targetUserId,
            password: profile.password, signal, onStage,
        });
        const handled = await handleSessionFailure({ result, adsPower, profile });
        return handled.stopProfile ? { ...result, ...handled } : result;
    } catch {
        return { ...actionFailure(actionError("Не вдалося підготувати профіль AdsPower", signal?.aborted ? "TASK_INTERRUPTED" : "ADSPOWER_PROFILE_PREPARATION_FAILED")), stage: "PROFILE" };
    }
}

export default function grantProfileFanPageAccess(...args) {
    return withHttpWorkflow("grantProfileFanPageAccess", () => grantProfileFanPageAccessImpl(...args), {
        metadata: { profileId: args[0]?.profileId, profileNo: args[0]?.profileNo },
    });
}
