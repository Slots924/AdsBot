import { hasGraphqlErrors, normalizeTimeout, parseFacebookJsonChunks } from "../education/common.js";

// TODO: При нагоді перевірити фактичну прив'язку номера окремим query.
// Поки COMPLETE трактуємо як прив'язаний телефон, INCOMPLETE — як неприв'язаний.
export default async function checkPhoneVerification({ page, adAccountId, timeout = 30000 }) {
    const accountId = String(adAccountId ?? "").trim().replace(/^act_/, "");
    const unknown = { adAccountId: accountId, phoneStatus: "UNKNOWN", completionStatus: null };
    let hostname = "";
    try { hostname = new URL(page?.url?.() ?? "").hostname; } catch {}
    if (typeof page?.evaluate !== "function" || hostname !== "adsmanager.facebook.com" || !/^\d+$/.test(accountId)) {
        return { ...unknown, reason: "INVALID_INPUT" };
    }
    try {
        const response = await page.evaluate(async ({ accountId, timeoutMs }) => {
            let fbDtsg;
            let userId;
            try {
                fbDtsg = require("DTSGInitialData")?.token;
                userId = require("CurrentUserInitialData")?.USER_ID;
            } catch { return { reason: "SESSION_UNAVAILABLE" }; }
            if (!fbDtsg || !userId) return { reason: "SESSION_UNAVAILABLE" };
            const body = new URLSearchParams({
                __aaid: accountId,
                __user: String(userId),
                __a: "1",
                fb_dtsg: fbDtsg,
                jazoest: `2${[...fbDtsg].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)}`,
                fb_api_caller_class: "RelayModern",
                fb_api_req_friendly_name: "SYDNUOWidgetContainerQuery",
                variables: JSON.stringify({ adAccountID: accountId }),
                doc_id: "40299379472978807",
            });
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const result = await fetch("/api/graphql/", {
                    method: "POST",
                    credentials: "include",
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body: body.toString(),
                    signal: controller.signal,
                });
                return { ok: result.ok, body: await result.text() };
            } catch { return { reason: "REQUEST_FAILED" }; }
            finally { clearTimeout(timer); }
        }, { accountId, timeoutMs: normalizeTimeout(timeout) });
        if (!response?.ok) return { ...unknown, reason: response?.reason ?? "HTTP_ERROR" };
        const chunks = parseFacebookJsonChunks(response.body);
        if (chunks.some(hasGraphqlErrors)) return { ...unknown, reason: "GRAPHQL_ERROR" };
        const account = chunks.find((chunk) => chunk?.data?.ad_account)?.data.ad_account;
        const tasks = account?.start_your_day_init_task_widgets;
        if (!Array.isArray(tasks)) return { ...unknown, reason: "TASKS_UNAVAILABLE" };
        const task = tasks.find((item) => item?.taskType === "PHONE_NUMBER_VERIFICATION");
        const completionStatus = task?.completionStatus ?? null;
        return {
            ...unknown,
            completionStatus,
            phoneStatus: completionStatus === "COMPLETE" ? "LINKED"
                : completionStatus === "INCOMPLETE" ? "NOT_LINKED" : "UNKNOWN",
        };
    } catch { return { ...unknown, reason: "CHECK_FAILED" }; }
}
