import { actionError, safeGraphText } from "./errors.js";

export default function parseResponse(response, { session = {} } = {}) {
    const source = String(response?.data ?? "").replace(/^\s*for\s*\(\s*;;\s*\);\s*/, "").trim();
    let chunks;
    try {
        try { chunks = [JSON.parse(source)]; }
        catch { chunks = source.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)); }
        if (!chunks.length || chunks.some((item) => !item || typeof item !== "object" || Array.isArray(item))) throw new Error();
    } catch {
        throw actionError("Facebook повернув неочікуваний формат. Результат заявки невідомий; перевірте його перед повтором", "FACEBOOK_RESPONSE_INVALID", {
            httpStatus: response?.status ?? null, outcomeUnknown: true, actionRequired: "check_friendship_status",
        });
    }
    const rawErrors = chunks.flatMap((item) => [
        ...(Array.isArray(item.errors) ? item.errors : []),
        ...(Array.isArray(item.data?.errors) ? item.data.errors : []),
        ...(item.error ? [typeof item.error === "object" ? item.error : { code: item.error, message: item.errorDescription || item.errorSummary }] : []),
    ]);
    const numericCode = (value) => typeof value === "number" || (typeof value === "string" && /^\d{1,20}$/.test(value)) ? value : null;
    const errors = rawErrors.slice(0, 10).map((entry) => {
        const error = entry && typeof entry === "object" ? entry : {};
        return {
            message: safeGraphText(error.message ?? error.description ?? "Facebook повернув помилку GraphQL", session),
            code: numericCode(error.code), api_error_code: numericCode(error.api_error_code ?? error.extensions?.api_error_code),
            error_subcode: numericCode(error.error_subcode ?? error.extensions?.error_subcode),
            type: safeGraphText(error.type ?? "", session) || null,
            error_user_title: safeGraphText(error.error_user_title ?? error.summary ?? "", session) || null,
            error_user_msg: safeGraphText(error.error_user_msg ?? error.description ?? "", session) || null,
            is_transient: error.is_transient === true,
        };
    });
    const httpStatus = response?.status ?? null;
    const traceId = safeGraphText(response?.headers?.["x-fb-trace-id"] ?? "", session) || null;
    const metaRequestId = safeGraphText(response?.headers?.["x-fb-request-id"] ?? "", session) || null;
    if (errors.length) {
        const first = errors[0];
        const partialResult = chunks.some((item) => item.data?.friend_request_send);
        const authenticationRequired = Number(first.code) === 190 || (Number(first.code) === 31 && Number(first.error_subcode) === 3858385);
        throw actionError(first.error_user_msg || first.message, "FACEBOOK_GRAPHQL_ERROR", {
            httpStatus, graphCode: first.code, graphSubcode: first.error_subcode, apiErrorCode: first.api_error_code,
            graphType: first.type, graphUserTitle: first.error_user_title, graphUserMessage: first.error_user_msg,
            traceId, metaRequestId, errors, isTransient: first.is_transient,
            ...(partialResult ? { outcomeUnknown: true, actionRequired: "check_friendship_status" } : {}),
            ...(authenticationRequired ? { sessionStatus: "login_required", actionRequired: "authenticate_account" } : {}),
        });
    }
    if (httpStatus < 200 || httpStatus >= 300) throw actionError(`Facebook повернув HTTP ${httpStatus}; заявку не підтверджено`, "FACEBOOK_HTTP_ERROR", {
        httpStatus, traceId, metaRequestId, outcomeUnknown: true, actionRequired: "check_friendship_status",
    });
    return { chunks, httpStatus, traceId, metaRequestId };
}
