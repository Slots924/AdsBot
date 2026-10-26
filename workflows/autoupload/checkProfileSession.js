import FacebookWebClient from "../../facebook/api/FacebookWebClient.js";
import normalizeProxy from "../../services/proxy/normalizeProxy.js";
import describeHttpError from "../../services/logging/httpDiagnostics.js";
import { getLogger } from "../../services/logging/runtimeLogger.js";

// Дані авторизації залишаються всередині клієнта й не входять до результату задачі.
export default async function checkProfileSession({ profileId, profile: suppliedProfile, proxy: suppliedProxy, adsPower, signal, onSessionStatus, onStage = () => {}, createClient = (options) => new FacebookWebClient(options) }) {
    const steps = [];
    let stage = "profile";
    let privateProxy;
    const note = async (message) => { steps.push(message); await onStage(message); };
    try {
        signal?.throwIfAborted();
        const profile = suppliedProfile ?? await adsPower.getProfileById(profileId);
        signal?.throwIfAborted();
        await note("Дані профілю отримано");
        stage = "proxy";
        let config = profile.user_proxy_config;
        if (!suppliedProxy && (!config?.proxy_host || !config?.proxy_port) && profile.fbcc_proxy_acc_id) {
            config = await adsPower.getProxyById(profile.fbcc_proxy_acc_id);
        }
        const proxy = suppliedProxy ?? { ...normalizeProxy(config), id: `adspower-profile-${profileId}` };
        privateProxy = proxy;
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
        return { client, result: { status: "active", stage, message: result.message,
            accountId: result.accountId, actorId: result.actorId, fields: result.fields, steps } };
    } catch (error) {
        if (signal?.aborted) throw error;
        const messages = {
            profile: "Не вдалося отримати профіль AdsPower",
            proxy: "Не вдалося отримати або налаштувати проксі профілю",
            cookies: "Не вдалося отримати cookies. Перевірте доступ до профілю та патч AdsPower",
            ua: "Не вдалося отримати UA. Перевірте патч AdsPower та формат відповіді API",
            facebook: "Помилка підготовки або перевірки сесії Facebook",
        };
        const diagnostic = describeHttpError(error, { stage, proxy: privateProxy });
        const message = error.sessionStatus || error.safeAdsPowerMessage || error.diagnostic || error.response ? diagnostic.message : `${messages[stage]}: ${diagnostic.message}`;
        getLogger("autoupload.session").error("autoupload.session.failed", message, { ...diagnostic, profileId });
        return { client: null, result: { status: error.sessionStatus ?? "error", errorStatus: diagnostic.status, stage, message, diagnostic, fields: [], steps: [...steps, message] } };
    }
}
