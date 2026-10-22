import { redactString } from "./AppLogger.js";

const codeValue = value => /^[A-Za-z0-9_:-]{1,100}$/.test(String(value ?? "")) ? value : null;
const numberValue = value => /^\d{1,15}$/.test(String(value ?? "")) ? Number(value) : null;
const privateKey = /token|cookie|authorization|password|secret|api.?key|fb_dtsg|lsd|jazoest|session|^xs$|^c_user$/i;

export function safeDiagnosticText(value, { proxy, session = {}, config = {} } = {}) {
    const secrets = [proxy?.host, proxy?.username, proxy?.password, ...Object.entries(session).filter(([key]) => privateKey.test(key)).map(([, value]) => value)];
    for (const [key, value] of Object.entries(config.headers ?? {})) {
        if (/authorization/i.test(key)) secrets.push(String(value).replace(/^Bearer\s+/i, ""));
        if (/cookie/i.test(key)) for (const part of String(value).split(";")) secrets.push(part.slice(part.indexOf("=") + 1).trim());
    }
    for (const source of [config.params, typeof config.data === "string" ? Object.fromEntries(new URLSearchParams(config.data)) : config.data]) {
        if (source && typeof source === "object") for (const [key, value] of Object.entries(source)) if (privateKey.test(key)) secrets.push(value);
    }
    let text = String(value ?? "");
    for (const secret of secrets.filter(value => typeof value === "string" && value).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[REDACTED]");
    return redactString(text)
        .replace(/https?:\/\/[^\s<>"']+/gi, value => { try { const url = new URL(value); return `${url.origin}${url.pathname}`; } catch { return "[URL]"; } })
        .replace(/(?:https?|socks5):\/\/[^\s<>"']*@[^\s<>"']+/gi, "[REDACTED]")
        .replace(/(["']?(?:fb_dtsg|lsd|jazoest|xs|c_user|access_token|sessionID)["']?\s*[:=]\s*)["']?[^\s,;"'}&]+["']?/gi, "$1[REDACTED]")
        .slice(0, 1500);
}

// Лише дозволені поля помилки: без axios config, payload, HTML та секретів сесії.
export default function describeHttpError(error, options = {}) {
    const previous = error?.diagnostic;
    const config = options.config ?? error?.config ?? error?.response?.config ?? {};
    let responseData = error?.response?.data;
    if (typeof responseData === "string" && responseData.length <= 2 * 1024 * 1024 && /^\s*\{/.test(responseData)) {
        try { responseData = JSON.parse(responseData); } catch {}
    }
    const graph = responseData?.error;
    const graphError = graph && typeof graph === "object" ? graph : null;
    const serverMessage = graphError?.error_user_msg || graphError?.message
        || (typeof responseData?.message === "string" ? responseData.message : null)
        || (typeof responseData?.msg === "string" ? responseData.msg : null)
        || (typeof responseData === "string" && /^text\/plain\b/i.test(error?.response?.headers?.["content-type"] ?? "") ? responseData : null);
    const httpStatus = numberValue(error?.httpStatus ?? error?.response?.status ?? previous?.httpStatus);
    const graphCode = numberValue(error?.graphCode ?? graphError?.code ?? previous?.graphCode);
    const networkCode = codeValue(error?.networkCode ?? previous?.networkCode ?? (/^(?:E[A-Z_]+|ERR_[A-Z_]+)$/.test(error?.code ?? "") ? error.code : error?.cause?.code));
    let status = previous?.status ?? "error";
    if (networkCode) status = /TIME|ECONNABORTED/.test(networkCode) ? "network_timeout" : "network_error";
    if (error?.code === "PROXY_POOL_EXHAUSTED" && !networkCode) status = "proxy_unavailable";
    if (httpStatus) status = httpStatus === 407 ? "proxy_auth_error" : httpStatus === 429 ? "rate_limited" : httpStatus === 403 ? "forbidden" : httpStatus >= 400 ? "http_error" : status;
    if (graphCode !== null) status = "facebook_api_error";
    if (error?.code === "FACEBOOK_RESPONSE_INVALID") status = "response_invalid";
    if (error?.code === "FACEBOOK_RESPONSE_EMPTY") status = "response_empty";
    if (error?.code === "ADS_MANAGER_ACCESS_TOKEN_NOT_FOUND") status = "access_token_missing";
    if (error?.code === "ADS_MANAGER_ACCOUNT_MISMATCH") status = "account_mismatch";
    if (error?.sessionStatus === "error" && status === "error") status = "session_error";
    if (["login_required", "checkpoint"].includes(error?.sessionStatus)) status = error.sessionStatus;
    let endpoint = previous?.endpoint ?? null;
    try { const url = new URL(options.url ?? config.url); endpoint = `${url.origin}${url.pathname}`; } catch {}
    const context = { ...options, config };
    const localMessage = error?.safeFacebookError || error?.safeAdsPowerMessage || error?.sessionStatus || networkCode ? error?.message : null;
    return { status, code: codeValue(error?.code) ?? previous?.code ?? "HTTP_REQUEST_FAILED", networkCode, httpStatus, graphCode,
        graphSubcode: numberValue(error?.graphSubcode ?? graphError?.error_subcode ?? previous?.graphSubcode),
        message: safeDiagnosticText(serverMessage || previous?.message || localMessage || "Не вдалося виконати HTTP-запит", context),
        stage: options.stage ?? error?.stage ?? previous?.stage ?? null, endpoint: safeDiagnosticText(endpoint ?? "", context) || null,
        method: String(options.method ?? config.method ?? previous?.method ?? "get").toUpperCase(),
        durationMs: options.durationMs ?? previous?.durationMs ?? null,
        traceId: safeDiagnosticText(error?.traceId ?? graphError?.fbtrace_id ?? previous?.traceId ?? "", context) || null,
    };
}
