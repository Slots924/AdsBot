import { actionError, actionFailure } from "../../graphql/errors.js";
import parseResponse from "../../graphql/parseResponse.js";
import { validateTargetUserId, validateFriendSession } from "../friends/common.js";
import describeHttpError from "../../../../services/logging/httpDiagnostics.js";

export { validateTargetUserId };
export const adminRole = "281423141961500";
export const adminPermissions = [1, 2, 3, 4, 5, 7];
export const managerOrigin = "https://adsmanager.facebook.com";
export const graphOrigin = "https://adsmanager-graph.facebook.com";

export function validateAdAccountId(value) {
    const id = String(value ?? "").trim().replace(/^act_/, "");
    if (!/^[1-9]\d{0,29}$/.test(id)) throw actionError("Вкажіть числовий ID рекламного кабінету", "FACEBOOK_AD_ACCOUNT_ID_INVALID");
    return id;
}

export function validateSession(fbData) {
    validateFriendSession(fbData);
    return fbData.client.getAdsManagerData(fbData);
}

// Парсер помилок спільний із рештою HTTP-дій; зовні повертається лише безпечна діагностика.
export async function requestJson(fbData, config) {
    const { session } = validateSession(fbData);
    let response;
    try {
        const request = new URL(config.url).origin === graphOrigin ? value => fbData.client.requestAdsManagerGraph(fbData, value) : value => fbData.client.request(value);
        response = await request({ ...config, allowHttpErrors: true, asFetch: true,
            headers: { Accept: "application/json", Origin: managerOrigin, Referer: `${managerOrigin}/`,
                "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Site": "same-site", ...config.headers } });
        const parsed = parseResponse(response, { session, mutation: config.mutation === true });
        if (parsed.chunks.length !== 1) throw actionError("Facebook повернув неоднозначну відповідь", "FACEBOOK_RESPONSE_INVALID", { httpStatus: response.status, outcomeUnknown: config.mutation === true });
        return { ...parsed, json: parsed.chunks[0] };
    } catch (error) {
        if (error.code === "FACEBOOK_GRAPHQL_ERROR" && ["login_required", "checkpoint"].includes(error.sessionStatus)) await fbData.client.invalidateSession(error);
        if (error.code === "FACEBOOK_RESPONSE_INVALID") error.message = "Не вдалося розібрати відповідь Facebook для доступів РК";
        if (error.code === "FACEBOOK_RESPONSE_INVALID" && response && !String(response.data ?? "").trim()) {
            error.code = "FACEBOOK_RESPONSE_EMPTY";
            error.message = "Facebook повернув порожню відповідь на запит доступів РК";
        }
        if (error.code === "FACEBOOK_HTTP_ERROR") error.message = `Facebook повернув HTTP ${error.httpStatus} для запиту доступів РК`;
        if (error.outcomeUnknown) {
            if (!error.sessionStatus) error.actionRequired = "check_ad_account_permissions";
            error.message = "Зміну доступів РК не підтверджено. Перевірте права перед повтором";
        } else if (["refresh_incoming_requests", "check_friendship_status"].includes(error.actionRequired)) {
            error.actionRequired = "check_ad_account_permissions";
        }
        error.diagnostic = { ...describeHttpError(error, { url: config.url, method: config.method ?? "get", stage: config.stage, session }),
            contentType: response?.headers?.["content-type"]?.split(";")[0] ?? null,
            responseBytes: response ? Buffer.byteLength(String(response.data ?? "")) : null };
        throw error;
    }
}

export function failure(error, { sent = false, signal, ...ids } = {}) {
    if (sent && !error?.safeFacebookError && !error?.sessionStatus) {
        error = actionError("Результат зміни доступів РК невідомий. Перевірте права перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true, actionRequired: "check_ad_account_permissions" });
    } else if (!sent && signal?.aborted) error = actionError("Задачу перервано до зміни доступів", "TASK_INTERRUPTED");
    return { ...actionFailure(error), ...ids };
}

export function isAdmin(user) {
    return Number(user?.role) === 1001 && adminPermissions.every(permission => user.permissions?.includes(permission));
}
