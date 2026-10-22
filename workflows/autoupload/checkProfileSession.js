import FacebookWebClient from "../../facebook/api/FacebookWebClient.js";
import normalizeProxy from "../../services/proxy/normalizeProxy.js";

// Дані авторизації залишаються всередині клієнта й не входять до результату задачі.
export default async function checkProfileSession({ profileId, adsPower, signal, onSessionStatus, onStage = () => {}, createClient = (options) => new FacebookWebClient(options) }) {
    const steps = [];
    let stage = "profile";
    const note = async (message) => { steps.push(message); await onStage(message); };
    try {
        signal?.throwIfAborted();
        const profile = await adsPower.getProfileById(profileId);
        signal?.throwIfAborted();
        await note("Дані профілю отримано");
        stage = "proxy";
        let config = profile.user_proxy_config;
        if ((!config?.proxy_host || !config?.proxy_port) && profile.fbcc_proxy_acc_id) {
            config = await adsPower.getProxyById(profile.fbcc_proxy_acc_id);
        }
        const proxy = { ...normalizeProxy(config), id: `adspower-profile-${profileId}` };
        await note("Проксі профілю налаштовано");
        stage = "cookies";
        signal?.throwIfAborted();
        const cookies = await adsPower.getProfileCookies(profileId);
        await note("Cookies отримано");
        stage = "ua";
        signal?.throwIfAborted();
        const userAgent = await adsPower.getProfileUserAgent(profileId);
        await note("User-Agent отримано");
        stage = "facebook";
        signal?.throwIfAborted();
        const client = createClient({ cookies, userAgent, proxy, onSessionStatus });
        const result = await client.checkSession({ signal });
        await note(result.message);
        return { client, result: { status: "active", stage, message: result.message, fields: result.fields, steps } };
    } catch (error) {
        if (signal?.aborted) throw error;
        const messages = {
            profile: "Не вдалося отримати профіль AdsPower",
            proxy: "Не вдалося отримати або налаштувати проксі профілю",
            cookies: "Не вдалося отримати cookies. Перевірте доступ до профілю та патч AdsPower",
            ua: "Не вдалося отримати UA. Перевірте патч AdsPower та формат відповіді API",
            facebook: "Помилка підготовки або перевірки сесії Facebook",
        };
        const message = error.sessionStatus || error.safeAdsPowerMessage ? error.message : messages[stage];
        return { client: null, result: { status: error.sessionStatus ?? "error", stage, message, fields: [], steps: [...steps, message] } };
    }
}
