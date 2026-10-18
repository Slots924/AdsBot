import hasBanTag from "./hasBanTag.js";
import hasLoginErrorTag from "./hasLoginErrorTag.js";
import hasChangeNameErrorTag from "./hasChangeNameErrorTag.js";

const tagChecks = new Map([
    ["BAN", hasBanTag],
    ["LOGIN_ERROR", hasLoginErrorTag],
    ["CHANGE_NAME_ERROR", hasChangeNameErrorTag],
]);

export default function getBlockedProfileTag(profile, blockedTags) {
    if (!Array.isArray(blockedTags) || blockedTags.some((tag) => !tagChecks.has(tag))) {
        throw new TypeError("Некоректний список заборонених тегів профілю");
    }
    return blockedTags.find((tag) => tagChecks.get(tag)(profile)) ?? null;
}
