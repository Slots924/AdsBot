import { randomUUID } from "node:crypto";
import { actionError } from "../../graphql/errors.js";
import { failure, managerOrigin, requestJson, validateSession, validateTargetUserId } from "./common.js";

// Внутрішній виклик без нової черги, щоб складена дія не блокувала сама себе.
export async function findFriend(fbData, targetUserId, { signal } = {}) {
    const { session } = validateSession(fbData);
    const url = new URL("/ajax/typeahead/first_degree.php", managerOrigin);
    const parameters = new URLSearchParams({ viewer: String(fbData.userId), "filter[0]": "user", "options[0]": "friends_only", request_id: randomUUID(), __a: "1", __user: String(fbData.userId), __req: Date.now().toString(36) });
    // Для GET потрібен актуальний async_get_token, отриманий із HTML Ads Manager.
    for (const [key, value] of Object.entries({ fb_dtsg_ag: session.fb_dtsg_ag, lsd: session.lsd, jazoest: session.jazoest, __rev: session.clientRevision })) if (value) parameters.set(key, String(value));
    url.search = parameters.toString();
    const { json, httpStatus } = await requestJson(fbData, { url: url.href, signal, mutation: false, stage: "friends_lookup" });
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
