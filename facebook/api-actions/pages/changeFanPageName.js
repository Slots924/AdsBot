import { readFacebookRuntime } from "../../api/runtime.js";
import {
    createResult,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../../api/browserRequest.js";
import { getFacebookTexts } from "../../i18n/index.js";

const nameEndpoint = "/ajax/settings/account/name.php";
const previewEndpoint = "/settings/name_change_preview/";

export const changeFanPageNameStatuses = Object.freeze(Object.fromEntries([
    "REQUEST_SUBMITTED", "NAME_NOT_ALLOWED", "FACEBOOK_VALIDATION_ERROR",
    "FACEBOOK_ERROR", "UNKNOWN_RESPONSE", "UNEXPECTED_FORM", "INVALID_INPUT",
    "ACTOR_CHANGED", "REQUEST_TIMEOUT", "REQUEST_FAILED", "HTTP_ERROR",
    "PARSE_ERROR", "ERROR",
].map((status) => [status, status])));

// Розбирає інертний HTML; команди Facebook та скрипти з відповіді не виконуються.
export function inspectNameChangeResponseInPage({ data, expectedPath }) {
    const htmlStrings = (value) => {
        if (!value || typeof value !== "object") return [];
        if (typeof value.__html === "string") return [value.__html];
        return Object.values(value).flatMap(htmlStrings);
    };
    const strings = (value) => {
        if (typeof value === "string") return [value];
        if (!value || typeof value !== "object") return [];
        return Object.values(value).flatMap(strings);
    };
    const text = (html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script, style").forEach((node) => node.remove());
        return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
    };
    const markup = Array.isArray(data.jsmods?.markup) ? data.jsmods.markup : [];
    const actions = Array.isArray(data.jsmods?.require) ? data.jsmods.require : [];
    const errors = actions.filter((action) => Array.isArray(action)
        && action[0] === "SettingsController" && action[1] === "showError");

    if (errors.length) {
        const ids = new Set(errors.flatMap((action) => strings(action.slice(3))));
        return {
            errorType: "FACEBOOK_VALIDATION_ERROR",
            message: markup.filter((entry) => Array.isArray(entry) && ids.has(entry[0]))
                .flatMap(htmlStrings).map(text).filter(Boolean).join(" ")
                || "Facebook викликав showError без доступного тексту помилки.",
        };
    }
    if (data.error || data.errorSummary || data.errorDescription
        || (Array.isArray(data.errors) && data.errors.length)) {
        return {
            errorType: "FACEBOOK_ERROR",
            message: [data.errorSummary, data.errorDescription,
                ...(Array.isArray(data.errors) ? data.errors.map((error) => error?.message) : [])]
                .flatMap((value) => typeof value === "string" ? [value] : htmlStrings(value))
                .map(text).filter(Boolean).join(" ") || "Facebook повернув явну помилку.",
        };
    }
    if (!expectedPath) {
        return {
            submitted: data.payload === true && actions.some((action) => Array.isArray(action)
                && action[0] === "SettingsController" && action[1] === "closeAndAnimateEdited"),
        };
    }

    const doc = new DOMParser().parseFromString(htmlStrings(markup).join("\n"), "text/html");
    const forms = [...doc.querySelectorAll("form")].filter((form) => {
        try {
            const url = new URL(form.getAttribute("action") || "", location.origin);
            return url.origin === location.origin && url.pathname === expectedPath
                && form.getAttribute("method")?.toLowerCase() === "post"
                && form.querySelector('[name="pseudonymous_name"]');
        } catch { return false; }
    });
    if (forms.length !== 1) return { errorType: "UNEXPECTED_FORM", message: "Очікувану форму не знайдено однозначно." };
    return {
        fields: [...new FormData(forms[0])].filter(([, value]) => typeof value === "string"),
        hasPassword: Boolean(forms[0].querySelector('input[name="save_password"][type="password"]')),
    };
}

// Подає заявку в активному Page-контексті без переходу до налаштувань і без повтору POST.
export default async function changeFanPageName({ page, name, password, additionalProfileId, timeout } = {}) {
    let stage = "INIT";
    let httpStatus;
    const secrets = new Set(typeof password === "string" && password ? [password] : []);
    const rememberSecrets = (fields) => {
        for (const [key, value] of fields) {
            if (value && /token|password|dtsg|jazoest|^lsd$|^__hsi$|^__s$/i.test(key)) secrets.add(String(value));
        }
    };
    const redact = (message) => {
        let safe = String(message ?? "");
        for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
            safe = safe.replaceAll(secret, "[REDACTED]");
        }
        return safe;
    };
    const result = (success, status, message, data = null) => createResult(success, status, data, {
        stage, ...(httpStatus !== undefined ? { httpStatus } : {}),
        message: redact(message), ...(!success ? { error: redact(message) } : {}),
    });
    const abort = (status, message) => { throw { actionStatus: status, safeMessage: message }; };
    const normalizedName = typeof name === "string" ? name.trim() : "";
    const expectedActor = String(additionalProfileId ?? "").trim();

    if (!page || typeof page.evaluate !== "function" || !normalizedName
        || typeof password !== "string" || !password) {
        return result(false, "INVALID_INPUT", "Потрібні Puppeteer page, непорожні name і password.");
    }

    try {
        const url = new URL(page.url());
        if (url.origin !== "https://www.facebook.com") {
            return result(false, "INVALID_INPUT", "Потрібна відкрита вкладка https://www.facebook.com у контексті Page.");
        }
        const runtime = await readFacebookRuntime(page, { surface: "facebook", timeout });
        const validationError = validateMutationInput(page, runtime);
        if (validationError) return result(false, "INVALID_INPUT", "Не вдалося підготувати авторизований Facebook runtime.");
        rememberSecrets(Object.entries(runtime));
        if (expectedActor && String(runtime.av) !== expectedActor) {
            return result(false, "ACTOR_CHANGED", "Активний actor не відповідає additionalProfileId.");
        }
        const requestTimeout = normalizeTimeout(timeout);
        const baseFields = Object.entries(runtime).filter(([key]) => !["accountId", "runtimeError"].includes(key));

        const request = async (endpoint, fields, expectedPath) => {
            httpStatus = undefined;
            let response;
            if (!fields) {
                response = await page.evaluate(async ({ endpoint, parameters, timeoutMs }) => {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), timeoutMs);
                    try {
                        const url = new URL(endpoint, location.origin);
                        url.search = new URLSearchParams(parameters).toString();
                        const response = await fetch(url, {
                            credentials: "include", redirect: "error", signal: controller.signal,
                        });
                        return { ok: response.ok, statusCode: response.status, body: await response.text() };
                    } catch (error) {
                        return { requestError: error?.name === "AbortError" ? "TIMEOUT" : "FETCH_FAILED" };
                    } finally { clearTimeout(timer); }
                }, { endpoint, parameters: baseFields, timeoutMs: requestTimeout });
            } else {
                rememberSecrets(fields);
                const parameters = new URLSearchParams(baseFields);
                for (const [key, value] of fields) parameters.set(key, value);
                // Поля форми не можуть підмінити actor, зафіксований на початку операції.
                parameters.set("av", String(runtime.av));
                parameters.set("__user", String(runtime.__user));
                response = await postFacebookForm(page, {
                    body: parameters.toString(), endpoint, timeout: requestTimeout,
                });
            }
            if (response.requestError) {
                const status = response.requestError === "TIMEOUT" ? "REQUEST_TIMEOUT"
                    : response.requestError === "FACEBOOK_ACTOR_CHANGED" ? "ACTOR_CHANGED" : "REQUEST_FAILED";
                abort(status, stage === "SUBMIT"
                    ? "Не отримано підтвердження заявки. Результат невідомий; автоматичного повтору немає."
                    : "Не вдалося виконати запит Facebook.");
            }
            httpStatus = response.statusCode;
            let data;
            try { data = parseFacebookJson(String(response.body ?? "").trimStart()); }
            catch { abort(response.ok ? "PARSE_ERROR" : "HTTP_ERROR", `HTTP ${httpStatus}: не вдалося розібрати відповідь Facebook.`); }
            if (!data || typeof data !== "object" || Array.isArray(data)) abort("UNKNOWN_RESPONSE", "Неочікувана структура JSON.");
            const inspected = await page.evaluate(inspectNameChangeResponseInPage, {
                data, expectedPath: response.ok ? expectedPath : undefined,
            });
            if (inspected.errorType) {
                const normalized = inspected.message.replace(/\s+/g, " ").trim().toUpperCase();
                const forbiddenName = inspected.errorType === "FACEBOOK_VALIDATION_ERROR"
                    && getFacebookTexts("pageNameChange.nameNotAllowed").some((text) => normalized.includes(text.replace(/\s+/g, " ").trim().toUpperCase()));
                abort(forbiddenName ? "NAME_NOT_ALLOWED" : inspected.errorType, inspected.message);
            }
            if (!response.ok) abort("HTTP_ERROR", `HTTP ${httpStatus}`);
            return inspected;
        };

        stage = "GET_FORM";
        const initial = await request(nameEndpoint, null, previewEndpoint);
        const previewFields = new URLSearchParams(initial.fields);
        previewFields.set("pseudonymous_name", normalizedName);
        // Не пересилає пароль із неочікуваної початкової форми до preview.
        previewFields.delete("save_password");

        stage = "PREVIEW";
        const preview = await request(previewEndpoint, previewFields, nameEndpoint);
        const finalFields = new URLSearchParams(preview.fields);
        if (finalFields.get("pseudonymous_name") !== normalizedName || !preview.hasPassword) {
            return result(false, "UNEXPECTED_FORM", "Назва або поле підтвердження не відповідає очікуваному.");
        }

        stage = "SUBMIT";
        finalFields.set("save_password", password);
        let submitted;
        try { submitted = await request(nameEndpoint, finalFields); }
        finally { finalFields.delete("save_password"); }
        return submitted.submitted
            ? result(true, "REQUEST_SUBMITTED", "Заявку на зміну назви прийнято.", { name: normalizedName })
            : result(false, "UNKNOWN_RESPONSE", "Прийняття заявки не підтверджене; автоматичного повтору немає.");
    } catch (error) {
        return result(false, error?.actionStatus || "ERROR",
            error?.safeMessage || "Неочікувана помилка зміни назви; сирі дані не збережено.");
    }
}
