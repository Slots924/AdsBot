import path from "node:path";
import parseWebSession from "../../facebook/session/parseWebSession.js";
import { extractFacebookAccessTokenFromHtml } from "../../facebook/api/browserCredentials.js";

const hidden = "[REDACTED]";
const fileDataKey = /^(?:(?:image|photo|file)[_-]?(?:base64|bytes|data)|base64)$/i;
const secretKey = /token|cookie|authorization|password|passwd|secret|api.?key|proxy|fb_dtsg|(?:^|-)lsd$|^(jazoest|session_?id|xs|datr|sb|c_user|public_key|key_id|card_data|credit_card_number|card_number|cardNumber|pan|cvv|csc|securityCode|sensitive_string_value|authData|secretPayload)$/i;

// Очищення історії не обрізає відповіді, масиви або вкладені GraphQL-дані.
export function cleanHistory(value, secrets = [], seen = new WeakSet()) {
    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        return { kind: "binary", bodyOmitted: true, bytes: value.byteLength };
    }
    if (typeof Blob !== "undefined" && value instanceof Blob) {
        return { kind: "file", bodyOmitted: true, size: value.size, type: value.type };
    }
    if (typeof value === "string") {
        let text = value;
        for (const secret of secrets) {
            if (!secret || String(secret).length < 4) continue;
            for (const variant of new Set([String(secret), encodeURIComponent(secret),
                new URLSearchParams({ value: secret }).toString().slice(6), JSON.stringify(String(secret)).slice(1, -1)])) {
                text = text.split(variant).join(hidden);
            }
        }
        return text.replace(/data:image\\?\/[^\s"'<>]+/gi, "[IMAGE OMITTED]")
            .replace(/((?:image|photo|file)[_-]?(?:base64|bytes|data)|base64)(["']\s*:\s*["'])[^"']*/gi, "$1$2[FILE OMITTED]")
            .replace(/EAA[A-Za-z0-9_-]+/g, hidden)
            .replace(/((?:access_?token|token|fb_dtsg|lsd|jazoest|password|authorization|cookie|session_?id)(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)[^"'\s,;&}]+/gi, `$1${hidden}`)
            .replace(/((?:token|access_?token|fb_dtsg|lsd|jazoest|password|authorization|cookie|session_?id)["']\s*:\s*["'])[^"']*/gi, `$1${hidden}`)
            .replace(/Bearer\s+[^\s"'<>]+/gi, `Bearer ${hidden}`)
            .replace(/((?:access_?token|fb_dtsg|lsd|jazoest|password|authorization|cookie|session_?id)\s*[=:]\s*)[^&\s"'<>]+/gi, `$1${hidden}`)
            .replace(/#PWD_[A-Z_]+:[^\s"'<>]+/g, hidden);
    }
    if (value == null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value !== "object") return String(value);
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const result = Array.isArray(value)
        ? value.map(item => cleanHistory(item, secrets, seen))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretKey.test(key) ? hidden
            : fileDataKey.test(key) && typeof item === "string"
                ? "[FILE OMITTED]" : cleanHistory(item, secrets, seen)]));
    seen.delete(value);
    return result;
}

export function historyUrl(value) {
    try {
        const url = new URL(value);
        url.username = "";
        url.password = "";
        for (const key of new Set(url.searchParams.keys())) if (secretKey.test(key)) url.searchParams.set(key, hidden);
        url.hash = "";
        return cleanHistory(url.href);
    } catch { return "[INVALID_URL]"; }
}

function decodeBody(value) {
    if (typeof value !== "string") return value;
    const text = value.replace(/^\s*for\s*\(\s*;;\s*\);\s*/, "");
    try { return JSON.parse(text); } catch {}
    const chunks = text.split(/\r?\n/).filter(line => line.trim());
    if (chunks.length > 1) {
        try { return { chunks: chunks.map(line => JSON.parse(line)) }; } catch {}
    }
    return value;
}

export function requestSnapshot(config) {
    let body = config.data ?? null;
    const type = String(config.headers?.["Content-Type"] ?? config.headers?.["content-type"] ?? "");
    if (/^image\//i.test(type)) body = { kind: "image", bodyOmitted: true, bytes: typeof body === "string" ? Buffer.byteLength(body) : body?.byteLength ?? null };
    else if (body instanceof URLSearchParams || (typeof body === "string" && (type.includes("x-www-form-urlencoded") || /^(?:[^=&]+=[^&]*)(?:&|$)/.test(body)))) {
        const form = new URLSearchParams(body);
        body = {};
        for (const [key, value] of form) {
            const item = decodeBody(value);
            body[key] = key in body ? [...(Array.isArray(body[key]) ? body[key] : [body[key]]), item] : item;
        }
    } else if (body && typeof body.entries === "function") {
        const fields = {};
        for (const [key, value] of body.entries()) {
            const item = typeof value === "string" ? value
                : { kind: "file", bodyOmitted: true, name: path.basename(value.name ?? "file"), size: value.size ?? null, type: value.type ?? null };
            fields[key] = key in fields ? [...(Array.isArray(fields[key]) ? fields[key] : [fields[key]]), item] : item;
        }
        body = fields;
    } else if (Buffer.isBuffer(body) || ArrayBuffer.isView(body) || body instanceof ArrayBuffer) body = { kind: "binary", bodyOmitted: true, bytes: body.byteLength };
    else if (body && typeof body.pipe === "function") body = { kind: "multipart-or-stream", bodyOmitted: true };
    else body = decodeBody(body);
    return { method: String(config.method ?? "get").toUpperCase(), url: historyUrl(config.url),
        params: config.params instanceof URLSearchParams ? Object.fromEntries(config.params) : config.params ?? null,
        headers: config.headers ?? {}, purpose: config.historyPurpose ?? "api", body,
        ...(typeof config.data === "string" && !body?.bodyOmitted ? { rawBody: config.data } : {}) };
}

export function responseSnapshot(response, config, secrets = new Set()) {
    const data = response.data;
    const text = typeof data === "string" ? data : "";
    const type = String(response.headers?.["content-type"] ?? response.headers?.["Content-Type"] ?? "");
    let body = decodeBody(data);
    // Призначення запиту визначає виняток для службових сторінок, а не Content-Type API-відповіді.
    const structured = body !== null && typeof body === "object" && !Buffer.isBuffer(body);
    const html = !structured && (/html/i.test(type) || /^\s*</.test(text) || /DTSGInitialData|"actorID"|"accessToken"/.test(text));
    const servicePage = ["session", "access-token", "runtime"].includes(config.historyPurpose);
    const script = config.historyPurpose === "static-resource" || /\.js(?:[?#]|$)|fbcdn\.net\/rsrc\.php\//i.test(String(config.url));
    const { session, missing } = parseWebSession(text);
    collectSecrets(session, secrets);
    if (!structured && servicePage) {
        body = { kind: "html", bodyOmitted: true, bytes: Buffer.byteLength(text),
            purpose: config.historyPurpose, expectedFormat: "facebook-runtime", formatMatched: html && missing.length === 0,
            sessionFieldsFound: Object.keys(session).filter(key => Boolean(session[key])), sessionFieldsMissing: [...missing, ...(!session.lsd ? ["lsd"] : [])],
            accessCredentialFound: Boolean(extractFacebookAccessTokenFromHtml(text)),
            adsManagerCredentialFound: Boolean(extractFacebookAccessTokenFromHtml(text, { prefix: "EAAB" })),
            loginFormFound: /id=["']login_form["']|\/login(?:[/?"']|$)/i.test(text),
            checkpointFound: /\/(?:checkpoint|two_step_verification|challenge)(?:[/?"']|$)/i.test(text),
            consentFound: /\/consent(?:[/?"']|$)|consent_flow/i.test(text),
            identityConfirmationFound: /\/confirmidentity(?:[/?"']|$)|identity_verification/i.test(text),
            extraction: { parser: "parseWebSession", status: missing.length ? "missing_fields" : "completed", missingRequiredFields: missing } };
    } else if (!structured && script) body = { kind: "javascript", bodyOmitted: true, bytes: Buffer.byteLength(text) };
    else if (/^image\//i.test(type) || Buffer.isBuffer(data) || ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
        body = { kind: /^image\//i.test(type) ? "image" : "binary", bodyOmitted: true,
            bytes: typeof data === "string" ? Buffer.byteLength(data) : data?.byteLength ?? null };
    }
    return { status: response.status, headers: response.headers ?? {}, body,
        ...(typeof data === "string" && !body?.bodyOmitted ? { rawBody: data } : {}) };
}

// Збирає значення credentials лише в пам'яті для очищення їхніх повторів у текстах помилок.
export function collectSecrets(value, secrets = new Set()) {
    if (typeof value === "string") {
        const decoded = decodeBody(value);
        if (decoded !== value) collectSecrets(decoded, secrets);
        return secrets;
    }
    if (!value || typeof value !== "object") return secrets;
    for (const [key, item] of Object.entries(value)) {
        if ((secretKey.test(key) || fileDataKey.test(key)) && typeof item === "string") {
            secrets.add(item);
            for (const part of item.split(/[;=\s]+/)) if (part.length >= 4) secrets.add(part);
        } else if (item && (typeof item === "object" || typeof item === "string")) collectSecrets(item, secrets);
    }
    return secrets;
}
