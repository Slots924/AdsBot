import normalizeProxy from "../services/proxy/normalizeProxy.js";
import checkProxy from "../services/proxy/checkProxy.js";
import hasBanTag from "../services/profile/hasBanTag.js";


export default async function checkProfileHealth(profile) {
    // Для забаненого профілю немає сенсу перевіряти проксі
    if (hasBanTag(profile)) {
        return "BANNED";
    }

    // Приводимо налаштування проксі AdsPower до формату перевірки
    const proxy = normalizeProxy(profile?.user_proxy_config);
    const proxyResult = await checkProxy(proxy);

    if (!proxyResult.working) {
        return "PROXY_FAILED";
    }

    return "READY";
}
