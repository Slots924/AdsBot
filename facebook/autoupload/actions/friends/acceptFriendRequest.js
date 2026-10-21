import { randomUUID } from "node:crypto";
import requestGraphql from "../../graphql/request.js";
import { actionError } from "../../graphql/errors.js";
import { validateTargetUserId, validateFriendSession, friendActionFailure } from "./common.js";

export const acceptFriendRequestMutation = Object.freeze({
    friendlyName: "FriendingCometFriendRequestConfirmMutation",
    // Ідентифікатор із наданого HAR; сесійні значення прикладу не використовуються.
    docId: "27351021931180810",
});

// Внутрішній варіант не створює вкладену чергу під час перевірки та прийняття.
export async function confirmFriendRequest(fbData, targetId, { signal, beforeSend } = {}) {
    let sent = false;
    let targetUserId;
    try {
        targetUserId = validateTargetUserId(targetId);
        if (targetUserId === String(fbData.userId)) throw actionError("Не можна прийняти заявку від самого себе", "FACEBOOK_FRIEND_REQUEST_SELF");
        const variables = { input: {
            friend_requester_id: targetUserId, actor_id: String(fbData.userId),
            friending_channel: "FRIENDS_HOME_MAIN", warn_ack: false, client_mutation_id: randomUUID(),
        }, scale: 1, refresh_num: 0, should_fix_banner: true };
        // Не генеруємо attribution та підтвердження кліку, яких немає в актуальній сесії.
        const { chunks, httpStatus, traceId, metaRequestId } = await requestGraphql(fbData, acceptFriendRequestMutation, variables, {
            signal, beforeSend: async () => { await beforeSend?.(); signal?.throwIfAborted(); sent = true; },
        });
        const requesters = chunks.map((chunk) => chunk.data?.friend_request_accept?.friend_requester).filter(Boolean);
        const requester = requesters.find((item) => String(item.id) === targetUserId);
        if (requester?.friendship_status !== "ARE_FRIENDS") throw actionError("Facebook не підтвердив прийняття потрібної заявки. Перевірте стан дружби перед повтором", "FACEBOOK_FRIEND_REQUEST_ACCEPT_NOT_CONFIRMED", {
            httpStatus, traceId, metaRequestId, outcomeUnknown: true, actionRequired: "check_friendship_status",
        });
        return { success: true, outcome: "FRIEND_REQUEST_ACCEPTED", code: null, message: "Заявку прийнято, дружбу підтверджено сервером",
            userId: targetUserId, targetUserId, friendshipStatus: "ARE_FRIENDS", friendship_status: "ARE_FRIENDS",
            httpStatus, traceId, metaRequestId, errors: [], retryable: false, outcomeUnknown: false };
    } catch (error) {
        return { ...friendActionFailure(error, { sent, signal, targetUserId: targetUserId ?? null }), userId: targetUserId ?? null };
    }
}

export default async function acceptFriendRequest(fbData, targetId, options = {}) {
    try {
        validateFriendSession(fbData);
        return await fbData.client.run(() => confirmFriendRequest(fbData, targetId, options));
    } catch (error) {
        return friendActionFailure(error, { signal: options.signal });
    }
}
