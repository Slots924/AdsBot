import HttpPageActionContext from "../HttpPageActionContext.js";
import FacebookPasswordEncryption from "../encryption/FacebookPasswordEncryption.js";
import switchToFanPage from "../actions/pages/switchToFanPage.js";
import getFanPageAdminPermissions from "../actions/pages/getFanPageAdminPermissions.js";
import reauthFanPageAdmin from "../actions/pages/reauthFanPageAdmin.js";
import inviteFanPageAdmin from "../actions/pages/inviteFanPageAdmin.js";
import { actionError, actionFailure } from "../graphql/errors.js";

// Усі зміни виконуються послідовно; невизначена mutation ніколи не повторюється автоматично.
export default async function grantFanPageAccess(client, {
    additionalProfileId, targetUserId, password, signal, onStage = () => {},
    encryption = new FacebookPasswordEncryption(client, { signal }),
} = {}) {
    const pageId = String(additionalProfileId ?? "").trim();
    const userId = String(targetUserId ?? "").trim();
    let stage = "VALIDATE", accountId = null, inviteSent = false, inviteAttempted = false;
    const context = new HttpPageActionContext(client, { signal });
    const note = async value => { stage = value; signal?.throwIfAborted(); await onStage(value); };
    const result = (outcome, details = {}) => ({ success: true, outcome, code: null, stage,
        accountId, additionalProfileId: pageId, targetUserId: userId,
        inviteSent, invitePending: false, outcomeUnknown: false, ...details,
    });
    const verify = () => getFanPageAdminPermissions(context, pageId, userId);
    try {
        if (!/^[1-9]\d*$/.test(pageId) || !/^[1-9]\d*$/.test(userId)) throw actionError("Потрібні числові ID фанки й отримувача", "FACEBOOK_ACCESS_INPUT_INVALID");
        if (typeof client?.run !== "function") throw actionError("Потрібен HTTP-клієнт Facebook", "FACEBOOK_SESSION_REQUIRED");
        return await client.run(async () => {
            await note("SESSION");
            accountId = (await context.refresh()).accountId;
            if (pageId === accountId || userId === accountId) throw actionError("Потрібні фанка та інший користувач", "FACEBOOK_ACCESS_INPUT_INVALID");
            await note("SWITCH");
            await switchToFanPage(context, pageId);
            await note("PERMISSIONS");
            await context.refresh({ permissionsPage: true });
            context.requireActor(pageId);
            const permissions = await verify();
            if (permissions.hasFullControl) return result("FULL_CONTROL_ALREADY_PRESENT", { verified: true, hasFullControl: true });
            if (permissions.invitePending) return result("INVITE_ALREADY_PENDING", { verified: true, invitePending: true });
            if (typeof password !== "string" || !password) throw actionError("У профілі відсутній пароль Facebook", "FACEBOOK_PASSWORD_REQUIRED");
            await note("ENCRYPT");
            const keys = permissions.encryptionKeys;
            if (!keys?.public_key || keys.key_id == null) throw actionError("Facebook не повернув ключ шифрування", "FACEBOOK_ENCRYPTION_KEYS_UNAVAILABLE");
            const encryptedPassword = await encryption.encrypt({ keyId: keys.key_id, publicKey: keys.public_key,
                password, scriptUrls: context.identity.scriptUrls,
            });
            await note("REAUTH");
            await reauthFanPageAdmin(context, pageId, encryptedPassword);
            await note("INVITE");
            inviteAttempted = true;
            try {
                await inviteFanPageAdmin(context, pageId, userId);
                inviteSent = true;
            } catch (error) {
                // Лише контрольне читання після збою запису, без повторної mutation.
                try {
                    const confirmed = await verify();
                    if (confirmed.invitePending || confirmed.hasFullControl) {
                        inviteSent = confirmed.invitePending;
                        return result("INVITE_CONFIRMED", { verified: true,
                            invitePending: confirmed.invitePending, hasFullControl: confirmed.hasFullControl,
                        });
                    }
                } catch {}
                throw error;
            }
            try {
                await note("VERIFY");
                const confirmed = await verify();
                return result("INVITE_SENT", { invitePending: confirmed.invitePending,
                    hasFullControl: confirmed.hasFullControl, verified: confirmed.invitePending || confirmed.hasFullControl,
                });
            } catch {
                return result("INVITE_SENT", { verified: false, invitePending: null,
                    warning: "Facebook прийняв інвайт, але контрольне читання не завершилося",
                });
            }
        });
    } catch (error) {
        // Сирі помилки можуть містити захищене поле пароля; назовні виходять лише коди.
        const safe = actionError(signal?.aborted ? "Операцію перервано" : `Не вдалося виконати етап ${stage}`,
            signal?.aborted ? "TASK_INTERRUPTED" : error?.safeFacebookError ? error.code : "FACEBOOK_ACCESS_FAILED", {
                httpStatus: error.httpStatus ?? null, graphCode: error.graphCode ?? null,
                apiErrorCode: error.apiErrorCode ?? null, outcomeUnknown: error.outcomeUnknown === true,
                sessionStatus: error.sessionStatus ?? null,
            });
        return { ...actionFailure(safe), stage, accountId, additionalProfileId: pageId,
            targetUserId: userId, inviteSent, invitePending: null, inviteAttempted,
        };
    }
}
