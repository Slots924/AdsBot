import { actionError, actionFailure } from "../../graphql/errors.js";

export function validateTargetUserId(value) {
    const targetUserId = String(value ?? "").trim();
    if (!/^[1-9]\d{0,29}$/.test(targetUserId)) throw actionError("Вкажіть числовий Facebook ID отримувача", "FACEBOOK_TARGET_ID_INVALID");
    return targetUserId;
}

export function validateFriendSession(fbData) {
    if (typeof fbData?.client?.run !== "function") throw actionError("Спочатку підготуйте активну сесію Facebook", "FACEBOOK_SESSION_REQUIRED");
    fbData.client.validateFbData(fbData);
}

export function friendActionFailure(error, { sent = false, signal, targetUserId = null } = {}) {
    if (sent && !error?.safeFacebookError && !["login_required", "checkpoint"].includes(error?.sessionStatus)) {
        error = actionError("Результат заявки невідомий. Перевірте стан перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true, actionRequired: "check_friendship_status" });
    } else if (!sent && signal?.aborted) {
        error = actionError("Задачу перервано до надсилання запиту", "TASK_INTERRUPTED");
    }
    return { ...actionFailure(error), targetUserId };
}
