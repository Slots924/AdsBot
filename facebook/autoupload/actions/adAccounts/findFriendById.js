import { randomUUID } from "node:crypto";
import { actionError } from "../../graphql/errors.js";
import { failure, managerOrigin, requestJson, validateSession, validateTargetUserId } from "./common.js";

// Внутрішній виклик без нової черги, щоб складена дія не блокувала сама себе.
export async function findFriend(fbData, targetUserId, { signal } = {}) {
    const url = new URL("/ajax/typeahead/first_degree.php", managerOrigin);
    url.search = new URLSearchParams({ viewer: String(fbData.userId), "filter[0]": "user", "options[0]": "friends_only", request_id: randomUUID() }).toString();
    const { json, httpStatus } = await requestJson(fbData, { url: url.href, signal, mutation: false });
    if (!Array.isArray(json.payload?.entries)) throw actionError("Facebook не повернув список друзів", "FACEBOOK_FRIEND_LIST_INVALID", { httpStatus });
    const entry = json.payload.entries.find(item => String(item?.uid) === targetUserId && item.is_friend_or_self === true);
    const friend = entry && targetUserId !== String(fbData.userId) ? { id: targetUserId, name: String(entry.text ?? "") } : null;
    return { success: true, outcome: friend ? "FRIEND_FOUND" : "FRIEND_NOT_FOUND_IN_RESPONSE", code: null,
        message: friend ? "Друга знайдено за Facebook ID" : "Потрібного друга не знайдено у відповіді Facebook", targetUserId,
        found: Boolean(friend), friend, loadedCount: json.payload.entries.length, httpStatus, outcomeUnknown: false, retryable: false };
}

export default async function findFriendById(fbData, targetId, options = {}) {
    let targetUserId;
    try {
        targetUserId = validateTargetUserId(targetId);
        validateSession(fbData);
        return await fbData.client.run(() => findFriend(fbData, targetUserId, options));
    } catch (error) { return failure(error, { signal: options.signal, targetUserId: targetUserId ?? null }); }
}
