import normalizeProxy from "../proxy/normalizeProxy.js";
import checkProxy from "../proxy/checkProxy.js";
import getBlockedProfileTag from "./tags/getBlockedProfileTag.js";
import isProfileOpen from "./isProfileOpen.js";


export default async function checkProfileHealth(
    adsPower, profile, { blockedTags = ["BAN", "LOGIN_ERROR"] } = {}
) {
    const blockedTag = getBlockedProfileTag(profile, blockedTags);
    if (blockedTag) return blockedTag === "BAN" ? "BANNED" : blockedTag;

    // Приводимо налаштування проксі AdsPower до формату перевірки
    const proxy = normalizeProxy(profile?.user_proxy_config);
    const proxyResult = await checkProxy(proxy);

    if (!proxyResult.working) {
        return "PROXY_FAILED";
    }

    // Після перевірки проксі переконуємося, що профіль вільний
    if (await isProfileOpen(adsPower, profile)) {
        return "ALREADY_OPEN";
    }

    return "READY";
}
