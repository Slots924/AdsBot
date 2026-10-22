import { actionError } from "../../graphql/errors.js";
import { adminRole, failure, graphOrigin, isAdmin, requestJson, validateAdAccountId, validateSession, validateTargetUserId } from "./common.js";
import { findFriend } from "./findFriendById.js";
import { readUsers } from "./getAdAccountUsers.js";

export default async function shareAdAccount(fbData, accountId, targetId, { signal, confirmation, beforeSend, useCachedAccess = false } = {}) {
    let adAccountId, targetUserId, sent = false, writeAccepted = false;
    try {
        adAccountId = validateAdAccountId(accountId);
        targetUserId = validateTargetUserId(targetId);
        if (confirmation?.confirmed !== true || confirmation.adAccountId !== adAccountId || confirmation.targetUserId !== targetUserId || confirmation.role !== "ADMIN") {
            throw actionError("Потрібне явне підтвердження Admin-доступу для цього користувача та РК", "FACEBOOK_ADMIN_CONFIRMATION_REQUIRED", { actionRequired: "confirm_admin_access" });
        }
        validateSession(fbData);
        return await fbData.client.run(async () => {
            signal?.throwIfAborted();
            if (!useCachedAccess) {
                const friend = await findFriend(fbData, targetUserId, { signal });
                if (!friend.found) throw actionError(friend.message, "FACEBOOK_FRIEND_NOT_FOUND", { httpStatus: friend.httpStatus });
                const existing = await readUsers(fbData, adAccountId, { signal });
                if (existing.users.some(user => user.id === targetUserId && isAdmin(user))) {
                    return { success: true, outcome: "AD_ACCOUNT_ALREADY_ADMIN", code: null, message: "Користувач уже має підтверджений Admin-доступ", adAccountId, targetUserId, httpStatus: existing.httpStatus, outcomeUnknown: false, retryable: false };
                }
                if (existing.incomplete) throw actionError("Список користувачів РК неповний: неможливо перевірити наявні права перед зміною", "FACEBOOK_AD_ACCOUNT_USERS_INCOMPLETE", { httpStatus: existing.httpStatus });
            }
            // Службові flowlet/xref не вигадуються і не копіюються зі старого HAR.
            const form = new URLSearchParams({ __aaid: adAccountId, __activeScenarioIDs: "[]", __activeScenarios: "[]", __interactionsMetadata: "[]",
                _reqName: "adaccount/users", _reqSrc: "AdsPermissionDialogController", account_id: adAccountId,
                ads_manager_write_regions: "true", include_headers: "false", locale: "en_US", method: "post", pretty: "0",
                role: adminRole, suppress_http_code: "1", uid: targetUserId });
            await beforeSend?.({ adAccountId, targetUserId, role: "ADMIN" });
            signal?.throwIfAborted();
            validateSession(fbData);
            sent = true;
            const response = await requestJson(fbData, { url: `${graphOrigin}/v22.0/act_${adAccountId}/users`, method: "post", data: form.toString(),
                signal, mutation: true, stage: "ad_account_admin_write", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
            if (response.json.success !== true) throw actionError("Facebook не підтвердив призначення Admin", "FACEBOOK_ADMIN_WRITE_NOT_CONFIRMED", { httpStatus: response.httpStatus, outcomeUnknown: true, actionRequired: "check_ad_account_permissions" });
            writeAccepted = true;
            if (useCachedAccess) return { success: true, outcome: "AD_ACCOUNT_ADMIN_WRITE_ACCEPTED", code: null,
                message: "Facebook підтвердив надання Admin-доступу", adAccountId, targetUserId,
                writeAccepted: true, verified: false, httpStatus: response.httpStatus, outcomeUnknown: false, retryable: false };
            let verified;
            try { verified = await readUsers(fbData, adAccountId, { signal }); }
            catch (error) { error.outcomeUnknown = true; if (!error.sessionStatus) error.actionRequired = "check_ad_account_permissions"; throw error; }
            const user = verified.users.find(item => item.id === targetUserId);
            if (!isAdmin(user)) throw actionError("POST прийнято, але Admin-права користувача не підтверджено у списку РК", "FACEBOOK_ADMIN_VERIFICATION_FAILED", {
                httpStatus: verified.httpStatus, outcomeUnknown: true, actionRequired: "check_ad_account_permissions" });
            return { success: true, outcome: "AD_ACCOUNT_ADMIN_GRANTED", code: null, message: "Admin-доступ підтверджено у списку користувачів РК", adAccountId, targetUserId,
                writeAccepted, verified: true, role: user.role, permissions: user.permissions, httpStatus: response.httpStatus, verificationHttpStatus: verified.httpStatus, outcomeUnknown: false, retryable: false };
        });
    } catch (error) { return { ...failure(error, { sent, signal, adAccountId: adAccountId ?? null, targetUserId: targetUserId ?? null }), writeAccepted }; }
}
