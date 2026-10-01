import { normalizeTimeout } from "../education/common.js";


const dialogPath = "/adaccount/agency/accept_reject_dialog/";
export const actionPath = "/adaccount/agency/request/accept_reject/";


export function validateAgencyRequestInput(page, adAccountId, agencyId, adMarketId) {
    const accountId = String(adAccountId ?? "").trim().replace(/^act_/, "");
    const businessId = String(agencyId ?? "").trim();
    const requestId = String(adMarketId ?? "").trim();
    let hostname = "";
    try {
        hostname = new URL(page?.url?.() ?? "").hostname;
    } catch {
        // Некоректну адресу вкладки повертаємо як помилку вхідних даних.
    }
    if (typeof page?.evaluate !== "function" || hostname !== "adsmanager.facebook.com"
        || !/^\d+$/.test(accountId) || !/^\d+$/.test(businessId)
        || !/^\d+$/.test(requestId)) {
        return { error: "Потрібні Puppeteer page на adsmanager.facebook.com і числові adAccountId, agencyId, adMarketId" };
    }
    return { adAccountId: accountId, agencyId: businessId, adMarketId: requestId };
}


// Виконує запит у вкладці Ads Manager, не виносячи session-токени за межі браузера.
export async function performAgencyRequest(page, {
    method,
    adAccountId,
    agencyId,
    adMarketId,
    operation,
    ext,
    hash,
    timeout,
}) {
    return page.evaluate(async (request) => {
        let actorId;
        let fbDtsg;
        let lsd;
        try {
            actorId = String(require("CurrentUserInitialData").USER_ID ?? "");
            fbDtsg = String(require("DTSGInitialData").token ?? "");
            lsd = String(require("LSD").token ?? "");
        } catch {
            return { runtimeUnavailable: true };
        }
        if (!/^\d+$/.test(actorId) || !fbDtsg || !lsd) {
            return { runtimeUnavailable: true };
        }

        const jazoest = `2${[...fbDtsg].reduce((sum, character) =>
            sum + character.charCodeAt(0), 0)}`;
        const parameters = new URLSearchParams({
            ad_market_id: request.adMarketId,
            agency_id: request.agencyId,
            __aaid: request.adAccountId,
            __user: actorId,
            __a: "1",
            jazoest,
        });
        if (request.method === "GET") {
            parameters.set("fb_dtsg_ag", fbDtsg);
        } else {
            parameters.set("operation", request.operation);
            parameters.set("ext", request.ext);
            parameters.set("hash", request.hash);
            parameters.set("fb_dtsg", fbDtsg);
            parameters.set("lsd", lsd);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), request.timeout);
        try {
            const endpoint = request.method === "GET"
                ? `${request.dialogPath}?${parameters}`
                : request.actionPath;
            const response = await fetch(endpoint, {
                method: request.method,
                credentials: "include",
                ...(request.method === "POST" ? {
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body: parameters.toString(),
                } : {}),
                signal: controller.signal,
            });
            return {
                ok: response.ok,
                statusCode: response.status,
                body: await response.text(),
            };
        } catch (error) {
            return {
                requestError: error?.name === "AbortError"
                    ? "TIMEOUT"
                    : String(error?.message ?? error),
            };
        } finally {
            clearTimeout(timer);
        }
    }, {
        method,
        adAccountId,
        agencyId,
        adMarketId,
        operation,
        ext,
        hash,
        timeout: normalizeTimeout(timeout),
        dialogPath,
        actionPath,
    });
}


// Витягає з Facebook response лише актуальні URL для цього запиту та цього BM.
export function parseAgencyDialog(body, { adAccountId, agencyId, adMarketId }) {
    const normalized = String(body ?? "")
        .replace(/\\\//g, "/")
        .replace(/\\u0026|\\x26/gi, "&")
        .replace(/\\u003d|\\x3d/gi, "=")
        .replace(/\\u003f|\\x3f/gi, "?")
        .replace(/&amp;|&#38;|&#x26;/gi, "&")
        .replace(/&quot;|&#34;|&#x22;/gi, '"');
    const candidates = normalized.match(
        /(?:https?:\/\/adsmanager\.facebook\.com)?\/adaccount\/agency\/request\/accept_reject\/\?[^"'<>\s\\]+/g
    ) ?? [];
    const actions = {};
    for (const candidate of candidates) {
        let url;
        try {
            url = new URL(candidate, "https://adsmanager.facebook.com");
        } catch {
            continue;
        }
        if (url.hostname !== "adsmanager.facebook.com" || url.pathname !== actionPath
            || url.searchParams.get("ad_market_id") !== adMarketId
            || url.searchParams.get("agency_id") !== agencyId) continue;

        const operation = url.searchParams.get("operation");
        const ext = url.searchParams.get("ext");
        const hash = url.searchParams.get("hash");
        if (!/^[01]$/.test(operation ?? "") || !/^\d+$/.test(ext ?? "")
            || !/^[A-Za-z0-9_-]+$/.test(hash ?? "")) continue;
        actions[operation === "0" ? "accept" : "reject"] = { ext, hash };
    }
    if (!actions.accept && !actions.reject) return null;
    return { adAccountId, agencyId, adMarketId, ...actions };
}


// Розпізнає явну помилку в AJAX-відповіді Facebook без повернення сирого body.
export function getAgencyResponseError(body) {
    try {
        const payload = JSON.parse(String(body ?? "").replace(/^for\s*\(\s*;;\s*\);\s*/, ""));
        const error = payload?.error ?? (Array.isArray(payload?.errors) ? payload.errors[0] : null);
        if (!error) return null;
        return {
            code: typeof error === "object" ? error.code ?? null : null,
            message: typeof error === "object"
                ? String(error.message ?? error.summary ?? payload.errorSummary ?? "Facebook повернув помилку")
                : String(payload.errorSummary ?? error),
        };
    } catch {
        return null;
    }
}
