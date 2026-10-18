import getBlockedProfileTag from "../../services/profile/tags/getBlockedProfileTag.js";
import ensureAdsPowerProfileReady from "./ensureAdsPowerProfileReady.js";

// Готовність перевіряємо до відкриття браузера; теги задає кожен виклик явно.
export default async function checkProfileBeforeLaunch({
    adsPower, profile, checks, actions = {},
}) {
    if (typeof checks?.adsPowerReady !== "boolean") {
        throw new TypeError("Потрібно явно вказати checks.adsPowerReady");
    }
    const blockedTag = getBlockedProfileTag(profile, checks.blockedTags);
    if (blockedTag) return { ok: false, blockedTag, adsPowerReady: null };
    const ready = checks.adsPowerReady
        ? Boolean(await (actions.ensureAdsPowerReady ?? ensureAdsPowerProfileReady)(
            adsPower, profile, { blockedTags: [] }
        ))
        : null;
    return { ok: ready !== false, blockedTag: null, adsPowerReady: ready };
}
