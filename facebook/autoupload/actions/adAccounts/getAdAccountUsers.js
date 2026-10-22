import { actionError } from "../../graphql/errors.js";
import { failure, graphOrigin, isAdmin, requestJson, validateAdAccountId, validateSession } from "./common.js";

export async function readUsers(fbData, adAccountId, { signal } = {}) {
    const url = new URL(`/v22.0/act_${adAccountId}`, graphOrigin);
    url.search = new URLSearchParams({ fields: "id,users{id,role,permissions}", __aaid: adAccountId }).toString();
    const { json, httpStatus } = await requestJson(fbData, { url: url.href, signal, mutation: false });
    if (String(json.id) !== `act_${adAccountId}` || !Array.isArray(json.users?.data)) {
        throw actionError("Facebook не повернув користувачів потрібного РК", "FACEBOOK_AD_ACCOUNT_USERS_INVALID", { httpStatus });
    }
    const users = json.users.data.filter(item => /^[1-9]\d{0,29}$/.test(String(item?.id))).map(item => ({
        id: String(item.id), role: Number(item.role) || null,
        permissions: Array.isArray(item.permissions) ? item.permissions.filter(value => Number.isInteger(value)) : [],
    }));
    return { success: true, outcome: "AD_ACCOUNT_USERS_LOADED", code: null, message: "Права користувачів РК отримано", adAccountId,
        users: users.map(user => ({ ...user, isAdmin: isAdmin(user) })), incomplete: Boolean(json.users.paging?.next), httpStatus, outcomeUnknown: false, retryable: false };
}

export default async function getAdAccountUsers(fbData, accountId, options = {}) {
    let adAccountId;
    try {
        adAccountId = validateAdAccountId(accountId);
        validateSession(fbData);
        return await fbData.client.run(() => readUsers(fbData, adAccountId, options));
    } catch (error) { return failure(error, { signal: options.signal, adAccountId: adAccountId ?? null }); }
}
