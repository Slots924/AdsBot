import { sanitize } from "../../services/logging/AppLogger.js";

export function summarizeGraphError(error) {
    if (!error || typeof error !== "object") return null;
    return sanitize(Object.fromEntries([
        "message", "type", "code", "error_subcode", "is_transient",
        "error_user_title", "error_user_msg", "fbtrace_id",
    ].filter((key) => error[key] !== undefined).map((key) => [key, error[key]])));
}

export function summarizeGraphResponse(response) {
    const body = response?.data;
    const object = body && typeof body === "object" ? body : {};
    const warnings = Array.isArray(object.warnings) ? object.warnings.slice(0, 10) : [];
    return {
        httpStatus: response?.status ?? null,
        contentType: response?.headers?.["content-type"] ?? null,
        traceId: response?.headers?.["x-fb-trace-id"] ?? object.__fb_trace_id__ ?? null,
        metaRequestId: response?.headers?.["x-fb-request-id"] ?? object.__www_request_id__ ?? null,
        bodyType: Array.isArray(body) ? "array" : typeof body,
        keys: Object.keys(object).filter((key) => !/(token|cookie|password|secret|proxy)/i.test(key)).slice(0, 30),
        id: typeof object.id === "string" || typeof object.id === "number" ? object.id : null,
        success: typeof object.success === "boolean" ? object.success : null,
        itemCount: Array.isArray(object.data) ? object.data.length : null,
        textLength: typeof body === "string" ? body.length : null,
        error: summarizeGraphError(object.error),
        warnings: warnings.map((warning) => typeof warning === "string"
            ? sanitize(warning) : summarizeGraphError(warning)),
    };
}

export function summarizeGraphRequest(params, data) {
    // Значення дозволяємо лише для службових параметрів; заголовки й повні payload не журналюємо.
    const fields = data instanceof URLSearchParams ? Object.fromEntries(data.entries()) : {};
    const values = { ...params, ...fields };
    return {
        parameterKeys: Object.keys(values).filter((key) => !/(token|cookie|password|secret|proxy|utm)/i.test(key)).slice(0, 30),
        ...Object.fromEntries(["fields", "limit", "status", "execution_options", "campaign_id", "adset_id"]
            .filter((key) => values[key] !== undefined).map((key) => [key, sanitize(values[key])])),
        hasBeneficiary: Boolean(fields.dsa_beneficiary),
        hasPayor: Boolean(fields.dsa_payor),
        hasBinaryData: data instanceof FormData,
    };
}
