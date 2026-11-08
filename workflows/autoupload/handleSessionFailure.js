import markProfileAsBanned from "../../services/profile/tags/markProfileAsBanned.js";
import { HUMAN_CONFIRMATION_REQUIRED } from "../../facebook/session/sessionStatus.js";

// Політика BAN належить workflow; клієнт Facebook лише повідомляє стан сесії.
export default async function handleSessionFailure({ result, adsPower, profile, profileId, profileNo, markBanned = markProfileAsBanned }) {
    if ((result?.sessionStatus ?? result?.status) !== HUMAN_CONFIRMATION_REQUIRED) return { stopProfile: false };
    if (result.banTag) return { stopProfile: true, banTag: result.banTag,
        ...(result.banWarning ? { banWarning: result.banWarning } : {}) };
    try {
        const current = profile ?? await (profileId ? adsPower.getProfileById(profileId) : adsPower.getProfileByNo(profileNo));
        const banTag = await markBanned(adsPower, current);
        return { stopProfile: true, banTag };
    } catch {
        return { stopProfile: true, banTag: { added: false, failed: true },
            banWarning: "Не вдалося додати тег BAN до профілю AdsPower" };
    }
}
