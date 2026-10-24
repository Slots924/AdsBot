import { randomUUID } from "node:crypto";
import requestGraphql from "../../graphql/request.js";
import { actionError, actionFailure } from "../../graphql/errors.js";
import parseWebSession from "../../../session/parseWebSession.js";

export function validateName(input = {}) {
    const name = Object.fromEntries(["firstName", "middleName", "lastName"].map(key => [key, String(input[key] ?? "").trim()]));
    if (!name.firstName || !name.lastName || Object.values(name).some(value => value.length > 100)) {
        throw actionError("Вкажіть ім’я та прізвище, до 100 символів у кожному полі", "FACEBOOK_NAME_INVALID_INPUT");
    }
    return name;
}

// Повторює запити соціального профілю з api-actions/accounts через збережену HTTP-сесію.
export default async function changeFacebookName(fbData, input, { signal, beforeSend } = {}) {
    let sent = false;
    try {
        const name = validateName(input);
        if (typeof fbData?.client?.run !== "function") throw actionError("Спочатку перевірте сесію Facebook", "FACEBOOK_SESSION_REQUIRED");
        return await fbData.client.run(async () => {
            fbData.client.validateFbData(fbData);
            const userId = String(fbData.userId);
            const home = await fbData.client.request({ url: "https://accountscenter.facebook.com/profiles/", signal, mutation: false });
            const { session } = parseWebSession(home.data);
            if (session.FacebookID !== userId) throw actionError("Не вдалося підтвердити поточний соціальний профіль в Accounts Center", "FACEBOOK_SESSION_MISMATCH");
            if (!session.fb_dtsg || !session.lsd) throw actionError("Не вдалося прочитати сесію Accounts Center", "FACEBOOK_SESSION_FIELDS_MISSING", { actionRequired: "refresh_session" });
            if (!session.jazoest) session.jazoest = `2${[...session.fb_dtsg].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`;
            const request = (friendlyName, docId, variables, options = {}) => requestGraphql(fbData, { friendlyName, docId }, variables, { signal, accountsCenter: true, formSession: session, mutation: false, ...options });
            const availability = await request("FXIMIdentityNameEditorDialogQuery", "25587875590838912", {
                field: "NAME", identity_id: userId, interface: "FB_WEB", platform: "FACEBOOK", scale: 1,
            });
            const identity = availability.chunks.map(chunk => chunk.data?.fxim_identity_for_id).find(Boolean);
            if (identity?.canonical_id && String(identity.canonical_id) !== userId) throw actionError("Accounts Center повернув інший профіль", "FACEBOOK_SESSION_MISMATCH");
            const rules = identity?.screen_rules?.name;
            const current = rules?.default_value;
            const normalize = value => String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
            if (current && [[current.firstname, name.firstName], [current.middlename, name.middleName], [current.lastname, name.lastName]].every(([a, b]) => normalize(a) === normalize(b))) {
                return { success: true, outcome: "NAME_UNCHANGED", message: "Соціальний профіль уже має вказане ім’я", outcomeUnknown: false, retryable: false };
            }
            if (rules?.legacy_name_data?.can_change_name !== true || rules.cooldown_status !== false) {
                throw actionError("Facebook не підтвердив доступність зміни імені соціального профілю", "FACEBOOK_NAME_CHANGE_UNAVAILABLE");
            }
            const variables = { identity_ids: [userId], first_name: name.firstName, middle_name: name.middleName, last_name: name.lastName };
            const validation = await request("useFXIMNameValidatorQuery", "26692801570319630", { ...variables, scale: 1, platform: "FACEBOOK" });
            const valid = validation.chunks.map(chunk => chunk.data?.fx_identity_management?.validate_name_v2).find(Boolean);
            if (valid?.is_valid !== true) throw actionError("Facebook не підтвердив коректність вказаного імені", "FACEBOOK_NAME_INVALID");
            const result = await request("useFXIMUpdateNameMutation", "9538143859625836", {
                ...variables, client_mutation_id: randomUUID(), family_device_id: "device_id_fetch_datr",
                full_name: [name.firstName, name.middleName, name.lastName].filter(Boolean).join(" "), interface: "FB_WEB",
            }, { mutation: true, beforeSend: async () => { await beforeSend?.(); signal?.throwIfAborted(); sent = true; } });
            const update = result.chunks.map(chunk => chunk.data?.fxim_update_identity_name).find(Boolean);
            if (!update) throw actionError("Facebook не підтвердив зміну імені. Перевірте ім’я перед повтором", "FACEBOOK_NAME_NOT_CONFIRMED", { outcomeUnknown: true });
            if (update.error != null) throw actionError("Facebook відхилив зміну імені соціального профілю", "FACEBOOK_NAME_REJECTED");
            return { success: true, outcome: "NAME_CHANGED", message: "Ім’я соціального профілю змінено", httpStatus: result.httpStatus, outcomeUnknown: false, retryable: false };
        });
    } catch (error) {
        const failure = actionFailure(error);
        if (sent && failure.code !== "FACEBOOK_NAME_REJECTED") failure.outcomeUnknown = true;
        if (failure.actionRequired === "refresh_incoming_requests") failure.actionRequired = "refresh_session";
        if (failure.outcomeUnknown) Object.assign(failure, { outcome: "OUTCOME_UNKNOWN", actionRequired: "check_profile_name", message: "Результат зміни імені невідомий. Перевірте ім’я соціального профілю перед повтором" });
        return failure;
    }
}
