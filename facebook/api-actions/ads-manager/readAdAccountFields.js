// Виконує читання Graph API у браузері поточної Facebook-сесії.
export default async function readAdAccountFields({ page, accessToken, adAccountId, fieldGroups, timeout = 60000 }) {
    const token = String(accessToken ?? "").trim();
    const accountId = String(adAccountId ?? "").replace(/^act_/, "").trim();
    if (!page?.evaluate || !token || !/^\d+$/.test(accountId)
        || !Array.isArray(fieldGroups) || !fieldGroups.length || fieldGroups.some((fields) => !String(fields ?? "").trim())) {
        return { success: false, status: "INVALID_INPUT", error: "Потрібні браузер, токен, ID рекламного акаунта та поля запиту" };
    }
    const timeoutMs = Number.isFinite(Number(timeout)) ? Math.max(1, Number(timeout)) : 60000;
    try {
        const response = await page.evaluate(async ({ tokenValue, id, groups, requestTimeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeout);
            const data = {};
            try {
                for (const fields of groups) {
                    const query = new URLSearchParams({ fields, access_token: tokenValue });
                    const result = await fetch(`https://graph.facebook.com/v26.0/act_${id}?${query}`, {
                        credentials: "include", signal: controller.signal,
                    });
                    const body = await result.json().catch(() => null);
                    if (!result.ok || body?.error) {
                        return { error: body?.error?.message ?? `Graph API: HTTP ${result.status}`, code: body?.error?.code ?? null, subcode: body?.error?.error_subcode ?? null };
                    }
                    if (!body || typeof body !== "object" || Array.isArray(body)) {
                        return { error: "Graph API не повернув коректних даних" };
                    }
                    Object.assign(data, body);
                }
                return { data };
            } catch (error) {
                return { error: error?.name === "AbortError" ? "Час очікування Graph API вичерпано" : "Не вдалося виконати браузерний запит до Graph API" };
            } finally { clearTimeout(timer); }
        }, { tokenValue: token, id: accountId, groups: fieldGroups, requestTimeout: timeoutMs });
        if (response?.error) {
            return { success: false, status: "GRAPH_API_ERROR", error: response.error, graphCode: response.code ?? null, graphSubcode: response.subcode ?? null };
        }
        if (!response?.data) return { success: false, status: "EMPTY_RESPONSE", error: "Graph API не повернув даних" };
        return { success: true, status: "FETCHED", data: response.data };
    } catch {
        return { success: false, status: "ERROR", error: "Не вдалося прочитати дані рекламного акаунта у браузері" };
    }
}
