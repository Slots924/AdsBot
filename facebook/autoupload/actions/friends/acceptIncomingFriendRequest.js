import { actionError } from "../../graphql/errors.js";
import { validateTargetUserId, validateFriendSession, friendActionFailure } from "./common.js";
import { loadIncomingFriendRequests } from "./getIncomingFriendRequests.js";
import { confirmFriendRequest } from "./acceptFriendRequest.js";

export default async function acceptIncomingFriendRequest(fbData, targetId, options = {}) {
    let targetUserId;
    try {
        targetUserId = validateTargetUserId(targetId);
        validateFriendSession(fbData);
        if (targetUserId === String(fbData.userId)) throw actionError("Не можна прийняти заявку від самого себе", "FACEBOOK_FRIEND_REQUEST_SELF");
        return await fbData.client.run(async () => {
            const incoming = await loadIncomingFriendRequests(fbData, options);
            const requester = incoming.requests.find((item) => item.id === targetUserId && item.status === "INCOMING_REQUEST");
            if (!requester) {
                throw actionError(incoming.incomplete
                    ? "Список вхідних заявок неповний: неможливо визначити, чи є заявка цього користувача"
                    : "У вхідних заявках немає цього користувача", incoming.incomplete ? "FACEBOOK_INCOMING_REQUESTS_INCOMPLETE" : "FACEBOOK_INCOMING_REQUEST_NOT_FOUND", {
                    actionRequired: incoming.incomplete ? "refresh_incoming_requests" : null,
                });
            }
            const result = await confirmFriendRequest(fbData, targetUserId, options);
            return { ...result, incomingIncomplete: incoming.incomplete };
        });
    } catch (error) {
        return { ...friendActionFailure(error, { signal: options.signal, targetUserId: targetUserId ?? null }), userId: targetUserId ?? null };
    }
}
