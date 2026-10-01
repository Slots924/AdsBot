const graphApiVersion = "v26.0";

// Читає доступні бізнеси лише в контексті відкритого браузера БМ.
export default async function getBrowserBusinessManagers({ page, accessToken }) {
    if (!page?.evaluate || !accessToken) return { success: false, status: "INVALID_INPUT" };
    try {
        const response = await page.evaluate(async ({ token, version }) => {
            const businesses = [];
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            let next = `https://graph.facebook.com/${version}/me/businesses?${new URLSearchParams({
                access_token: token, fields: "id,name,verification_status", limit: "100",
            })}`;
            try {
                while (next) {
                    const result = await fetch(next, { credentials: "include", signal: controller.signal });
                    const body = await result.json().catch(() => null);
                    if (!result.ok || body?.error) return { error: body?.error?.message || `HTTP ${result.status}` };
                    businesses.push(...(body?.data ?? []));
                    next = body?.paging?.next || "";
                }
                return { businesses };
            } finally {
                clearTimeout(timer);
            }
        }, { token: accessToken, version: graphApiVersion });
        if (response?.error) return { success: false, status: "GRAPH_API_ERROR", error: response.error };
        return { success: true, status: "BUSINESSES_FETCHED", data: (response?.businesses ?? []).map((item) => ({
            id: String(item.id),
            name: String(item.name || "БМ без назви"),
            active: item.verification_status !== "rejected" && item.verification_status !== "disabled",
        })) };
    } catch (error) {
        return { success: false, status: "REQUEST_FAILED", error: String(error?.message ?? error) };
    }
}
