import { randomUUID } from "node:crypto";
import buildForm from "../../graphql/buildForm.js";
import parseResponse from "../../graphql/parseResponse.js";
import { actionError, actionFailure } from "../../graphql/errors.js";

export const friendRequestMutation = Object.freeze({
    friendlyName: "FriendingCometFriendRequestSendMutation",
    // Ідентифікатор із наданого HAR; зберігається окремо від даних сесії.
    docId: "28548786588082329",
});

export function validateTargetUserId(value) {
    const targetUserId = String(value ?? "").trim();
    if (!/^[1-9]\d{0,29}$/.test(targetUserId)) throw actionError("Вкажіть числовий Facebook ID отримувача", "FACEBOOK_TARGET_ID_INVALID");
    return targetUserId;
}

export default async function sendFriendRequest(fbData, targetId, { signal, beforeSend } = {}) {
    let targetUserId;
    let sent = false;
    try {
        targetUserId = validateTargetUserId(targetId);
        if (String(fbData?.userId) === targetUserId) throw actionError("Не можна надіслати заявку самому собі", "FACEBOOK_FRIEND_REQUEST_SELF");
        if (typeof fbData?.client?.run !== "function") throw actionError("Спочатку підготуйте активну сесію Facebook", "FACEBOOK_SESSION_REQUIRED");
        return await fbData.client.run(async () => {
            signal?.throwIfAborted();
            fbData.client.validateFbData(fbData);
            const variables = { input: {
                friend_requestee_ids: [targetUserId], actor_id: String(fbData.userId),
                friending_channel: "PROFILE_BUTTON", warn_ack_for_ids: [], client_mutation_id: randomUUID(),
            }, scale: 1 };
            // Не вигадуємо підтвердження кліку чи захисні поля, яких немає в актуальному контексті.
            const form = buildForm(fbData, { ...friendRequestMutation, variables });
            await beforeSend?.();
            signal?.throwIfAborted();
            sent = true;
            const response = await fbData.client.request({
                url: "https://www.facebook.com/api/graphql/", method: "post", data: form.toString(), signal,
                mutation: true, allowHttpErrors: true,
                headers: { "Content-Type": "application/x-www-form-urlencoded", "X-FB-Friendly-Name": friendRequestMutation.friendlyName, "X-FB-LSD": fbData.session.lsd },
            });
            const { chunks, httpStatus, traceId, metaRequestId } = parseResponse(response, fbData);
            const recipients = chunks.flatMap((chunk) => Array.isArray(chunk.data?.friend_request_send?.friend_requestees) ? chunk.data.friend_request_send.friend_requestees : []);
            const recipient = recipients.find((item) => String(item?.id) === targetUserId);
            const friendshipStatus = recipient?.friendship_status ?? null;
            if (friendshipStatus !== "OUTGOING_REQUEST") throw actionError("Facebook не підтвердив заявку для потрібного отримувача. Перевірте стан перед повтором", "FACEBOOK_FRIEND_REQUEST_NOT_CONFIRMED", {
                httpStatus, traceId, metaRequestId, friendshipStatus: typeof friendshipStatus === "string" && /^[A-Z_]{1,60}$/.test(friendshipStatus) ? friendshipStatus : null,
                outcomeUnknown: true, actionRequired: "check_friendship_status",
            });
            return { success: true, outcome: "FRIEND_REQUEST_SENT", code: null, message: "Заявку в друзі підтверджено сервером", targetUserId,
                friendshipStatus, httpStatus, traceId, metaRequestId, errors: [], outcomeUnknown: false, retryable: false };
        });
    } catch (error) {
        if (sent && !error.safeFacebookError && !["login_required", "checkpoint"].includes(error.sessionStatus)) {
            error = actionError("Результат заявки невідомий. Перевірте стан перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true, actionRequired: "check_friendship_status" });
        } else if (!sent && signal?.aborted) {
            error = actionError("Задачу перервано до надсилання заявки", "TASK_INTERRUPTED");
        }
        return { ...actionFailure(error), targetUserId: targetUserId ?? null };
    }
}
