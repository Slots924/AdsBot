import checkProfileSession from "./checkProfileSession.js";
import getAdsManagerSession from "../../facebook/autoupload/actions/getAdsManagerSession.js";
import { actionFailure } from "../../facebook/autoupload/graphql/errors.js";

// Одна повна перевірка оновлює сесії й активи; секрети не потрапляють у result.
export default async function refreshProfileSession(options) {
    const prepared = await checkProfileSession(options);
    const { client, result } = prepared;
    const assets = { adAccounts: [], pages: [], adAccountsState: "unavailable", pagesState: "unavailable" };
    result.assets = assets;
    result.capabilities = { facebook: Boolean(client), adsManager: false, accessToken: false };
    result.warnings = [];
    if (!client) return prepared;
    const note = async (message) => { result.steps.push(message); await options.onStage?.(message); };
    try {
        options.signal?.throwIfAborted();
        await getAdsManagerSession(client.getFbData(options.profileId), { signal: options.signal });
        Object.assign(result.capabilities, { adsManager: true, accessToken: true });
        await note("Сесію Ads Manager та access token отримано");
        const api = client.createGraphApi();
        const load = async (label, stateKey, operation, select) => {
            options.signal?.throwIfAborted();
            try {
                const values = await operation();
                assets[label] = values.map(select);
                assets[stateKey] = "loaded";
            } catch (error) {
                const code = typeof error.graphCode === "number" ? error.graphCode : null;
                assets[stateKey] = "error";
                result.warnings.push({ scope: label, code: "FACEBOOK_ASSETS_FAILED", graphCode: code,
                    message: code === 190 ? "Access token недійсний: потрібна нова перевірка" : "Не вдалося завантажити активи: перевірте права доступу або з’єднання" });
            }
        };
        await load("adAccounts", "adAccountsState", () => api.getAdAccounts(), (item) => ({ id: String(item.id), accountId: String(item.accountId || item.id).replace(/^act_/, ""), name: String(item.name ?? ""), accountStatus: Number(item.accountStatus) || null, businessId: item.business?.id ? String(item.business.id) : null, isPersonal: !item.business }));
        await load("pages", "pagesState", () => api.getPages({ force: true }), (item) => ({ id: String(item.id), name: String(item.name ?? "") }));
        await note(`Рекламних кабінетів: ${assets.adAccounts.length}; фанпейджів: ${assets.pages.length}`);
    } catch (error) {
        if (options.signal?.aborted) throw error;
        const safe = actionFailure(error);
        result.warnings.push({ scope: "adsManager", code: safe.code, message: safe.message });
        if (["login_required", "checkpoint"].includes(safe.sessionStatus)) {
            result.status = safe.sessionStatus;
            result.message = safe.message;
            result.capabilities = { facebook: false, adsManager: false, accessToken: false };
            return { client: null, result };
        }
    }
    result.hasWarnings = result.warnings.length > 0;
    result.message = result.hasWarnings ? "Facebook активний; частину даних Ads Manager або активів не оновлено" : "Акаунт перевірено, сесії та активи оновлено";
    return { client, result };
}
