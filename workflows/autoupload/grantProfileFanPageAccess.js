import grantFanPageAccess from "../../facebook/autoupload/workflows/grantFanPageAccess.js";
import checkProfileSession from "./checkProfileSession.js";
import { actionError, actionFailure } from "../../facebook/autoupload/graphql/errors.js";

// AdsPower залишається зовнішньою інтеграцією: Facebook-workflow отримує лише клієнт і пароль.
export default async function grantProfileFanPageAccess({
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
        const prepared = await checkProfileSession({ profileId: profile.profile_id, adsPower, signal });
        if (!prepared.client) return { success: false, stage: "SESSION", outcome: "NOT_CONFIRMED",
            code: "FACEBOOK_SESSION_REQUIRED", message: prepared.result.message, sessionStatus: prepared.result.status,
            additionalProfileId, targetUserId, outcomeUnknown: false,
        };
        return await grantFanPageAccess(prepared.client, { additionalProfileId, targetUserId,
            password: profile.password, signal, onStage,
        });
    } catch {
        return { ...actionFailure(actionError("Не вдалося підготувати профіль AdsPower", signal?.aborted ? "TASK_INTERRUPTED" : "ADSPOWER_PROFILE_PREPARATION_FAILED")), stage: "PROFILE" };
    }
}
