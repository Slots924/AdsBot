import { randomUUID } from "node:crypto";
import {
    buildMutationBody, createResult, hasGraphqlErrors, normalizeTimeout,
    parseFacebookJson, postFacebookForm, validateMutationInput,
} from "../education/common.js";
import { fullAdAccountTaskIds } from "./requestAdAccountAccess.js";

const friendlyName = "BizKitSettingsInvitePeopleModalMutation";
const docId = "31295717360015609";
const employeeTaskIds = ["926381894526285"];
const adminTaskIds = [
    "926381894526285", "603931664885191", "1327662214465567", "862159105082613",
    "6161001899617846786", "1633404653754086", "967306614466178",
    "2848818871965443", "245181923290198", "388517145453246",
];
// Фінансовий набір визначено як різницю наданих прикладів; поєднання з ADMIN потребує живої перевірки.
const financeTaskIds = ["768085000593466", "416103972652535"];
const fullPageTaskIds = [
    "461340961883703", "2565488997052663", "556750461849806", "275298030109664",
    "696659004201852", "270956550540539", "794616964377599", "997951390947110",
    "967977242754531", "1370797498202499", "290727579301631",
];

export const inviteBusinessUserStatuses = Object.freeze({
    PENDING: "PENDING",
    INVITE_RESULT_UNEXPECTED: "INVITE_RESULT_UNEXPECTED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    REQUEST_FAILED: "REQUEST_FAILED",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    ERROR: "ERROR",
});

// Не перетворює неточні числові ID на рядки та прибирає повторні активи.
function normalizeIds(ids, stripPrefix = false) {
    if (!Array.isArray(ids)) throw new Error("ID активів потрібно передавати масивом рядків");
    return [...new Set(ids.map((id) => {
        if (typeof id !== "string") throw new Error("ID потрібно передавати рядками");
        const value = stripPrefix ? id.trim().replace(/^act_/, "") : id.trim();
        if (!/^[1-9]\d*$/.test(value)) throw new Error("Некоректний ID активу");
        return value;
    }))];
}

// Запрошує людей до БМ і призначає повні права лише на передані активи в поточній браузерній сесії.
export default async function inviteBusinessUser({
    page, commonPayload, businessId, emails, role = "EMPLOYEE", financeAccess = true,
    pageIds = [], adAccountIds = [], timeout,
} = {}) {
    let normalizedEmails, normalizedPages, normalizedAccounts, normalizedBusinessId;
    try {
        const validationError = validateMutationInput(page, commonPayload);
        if (validationError) throw new Error(validationError);
        if (new URL(page.url()).origin !== "https://business.facebook.com") {
            throw new Error("Потрібна сторінка business.facebook.com");
        }
        normalizedBusinessId = normalizeIds([businessId])[0];
        if (!["ADMIN", "EMPLOYEE"].includes(role) || typeof financeAccess !== "boolean") {
            throw new Error("Потрібні роль ADMIN або EMPLOYEE та булевий financeAccess");
        }
        for (const field of ["av", "__user"]) {
            if (!/^[1-9]\d*$/.test(String(commonPayload[field] ?? ""))) {
                throw new Error(`Некоректне поле ${field} у commonPayload`);
            }
        }
        for (const field of ["fb_dtsg", "jazoest", "lsd", "__a", "__comet_req"]) {
            if (!String(commonPayload[field] ?? "").trim()) throw new Error(`Порожнє поле ${field}`);
        }
        if (!Array.isArray(emails) || !emails.length || emails.some((email) =>
            typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
            throw new Error("Потрібен непорожній масив коректних emails");
        }
        normalizedEmails = [...new Set(emails.map((email) => email.trim()))];
        normalizedPages = normalizeIds(pageIds);
        normalizedAccounts = normalizeIds(adAccountIds, true);
        if (normalizedPages.some((id) => normalizedAccounts.includes(id))) {
            throw new Error("Один ID не може одночасно бути фанкою і РК");
        }
    } catch (error) {
        return createResult(false, inviteBusinessUserStatuses.INVALID_INPUT, null, {
            error: String(error?.message ?? error),
        });
    }

    try {
        const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
        const variables = { input: {
            actor_id: String(commonPayload.av),
            client_mutation_id: randomUUID(),
            business_id: normalizedBusinessId,
            business_emails: normalizedEmails,
            business_account_task_ids: [...new Set([
                ...(role === "ADMIN" ? adminTaskIds : employeeTaskIds),
                ...(financeAccess ? financeTaskIds : []),
            ])],
            invite_origin_surface: "MBS_INVITE_USER_FLOW",
            assets: [
                ...normalizedPages.map((id) => ({ asset_id: id, permitted_task_ids: fullPageTaskIds })),
                ...normalizedAccounts.map((id) => ({ asset_id: id, permitted_task_ids: fullAdAccountTaskIds })),
            ],
            use_detailed_coded_exception: true,
            auto_assign_access: false,
            expiry_time: 0,
            is_spark_permission: false,
            client_timezone_id: timezone,
        } };
        const body = buildMutationBody(commonPayload, {
            friendlyName, docId, variables, extraParameters: { __bid: normalizedBusinessId },
        });
        // Виконує одну спробу: після таймауту запрошення вже могло бути створене.
        const response = await postFacebookForm(page, {
            body, friendlyName, lsd: commonPayload.lsd, timeout: normalizeTimeout(timeout),
        });
        if (response.requestError) return createResult(false,
            response.requestError === "TIMEOUT" ? inviteBusinessUserStatuses.REQUEST_TIMEOUT
                : inviteBusinessUserStatuses.REQUEST_FAILED);
        if (!response.ok) return createResult(false, inviteBusinessUserStatuses.HTTP_ERROR, null, {
            httpStatus: response.statusCode,
        });
        let data;
        try { data = parseFacebookJson(response.body); } catch {
            return createResult(false, inviteBusinessUserStatuses.PARSE_ERROR);
        }
        if (hasGraphqlErrors(data)) return createResult(false, inviteBusinessUserStatuses.GRAPHQL_ERROR,
            null, { graphErrors: data.errors });
        const requests = data?.data?.business_settings_invite_business_users?.business_role_requests;
        if (!Array.isArray(requests) || requests.length !== normalizedEmails.length
            || requests.some((request) => !request?.id || request.role_request_status !== "PENDING")) {
            return createResult(false, inviteBusinessUserStatuses.INVITE_RESULT_UNEXPECTED);
        }
        return createResult(true, inviteBusinessUserStatuses.PENDING, {
            businessId: normalizedBusinessId,
            role,
            financeAccess,
            requests: requests.map((request) => ({
                id: String(request.id),
                status: request.role_request_status,
                expirationTime: request.expiration_time ?? null,
            })),
        });
    } catch (error) {
        return createResult(false, inviteBusinessUserStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
