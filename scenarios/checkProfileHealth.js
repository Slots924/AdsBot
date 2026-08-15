import normalizeProxy from "../services/proxy/normalizeProxy.js";
import checkProxy from "../services/proxy/checkProxy.js";
import hasBanTag from "../services/profile/hasBanTag.js";
import hasLoginErrorTag from "../services/profile/hasLoginErrorTag.js";
import isProfileOpen from "../services/profile/isProfileOpen.js";


export default async function checkProfileHealth(adsPower, profile) {
    // Для забаненого профілю немає сенсу перевіряти проксі
    if (hasBanTag(profile)) {
        return "BANNED";
    }

    // Профіль із проблемою входу не потрібно перевіряти далі
    if (hasLoginErrorTag(profile)) {
        return "LOGIN_ERROR";
    }

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
