const graphApiVersion = "v26.0";
const defaultTimeoutMs = 30000;


export const getFanPagesStatuses = Object.freeze({
    FAN_PAGES_FETCHED: "FAN_PAGES_FETCHED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPH_API_ERROR: "GRAPH_API_ERROR",
    ERROR: "ERROR",
});


// Зчитує сторінки, доступні основному профілю, через поточну browser-сесію.
export default async function getFanPages({ page, accessToken, timeout = defaultTimeoutMs }) {
    const token = String(accessToken ?? "").trim();
    const timeoutMs = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;
    if (!page || typeof page.evaluate !== "function" || !token) {
        return {
            success: false,
            status: getFanPagesStatuses.INVALID_INPUT,
            data: null,
            error: !page ? "Не передано Puppeteer page" : "Потрібен accessToken",
        };
    }

    try {
        const response = await page.evaluate(async ({ tokenValue, requestTimeout, version }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeout);
            const pages = [];
            let after = "";
            try {
                do {
                    const query = new URLSearchParams({
                        access_token: tokenValue,
                        fields: "id,name,picture{url}",
                        limit: "100",
                    });
                    if (after) query.set("after", after);
                    const result = await fetch(
                        `https://graph.facebook.com/${version}/me/accounts?${query}`,
                        { credentials: "include", signal: controller.signal }
                    );
                    const body = await result.json().catch(() => null);
                    if (!result.ok || body?.error) {
                        return { ok: false, statusCode: result.status, graphError: body?.error ?? null };
                    }
                    if (Array.isArray(body?.data)) pages.push(...body.data);
                    after = String(body?.paging?.cursors?.after ?? "");
                    if (!body?.paging?.next) after = "";
                } while (after);
                return { ok: true, pages };
            } catch (error) {
                return { ok: false, timeout: error?.name === "AbortError", error: String(error?.message ?? error) };
            } finally {
                clearTimeout(timer);
            }
        }, { tokenValue: token, requestTimeout: timeoutMs, version: graphApiVersion });
        if (response?.timeout) return { success: false, status: getFanPagesStatuses.REQUEST_TIMEOUT, data: null };
        if (response?.graphError) {
            return { success: false, status: getFanPagesStatuses.GRAPH_API_ERROR, data: null, error: response.graphError.message ?? "Graph API повернув помилку" };
        }
        if (!response?.ok) {
            return { success: false, status: getFanPagesStatuses.HTTP_ERROR, data: null, error: response?.error ?? "Не вдалося отримати фанпейджі" };
        }
        return {
            success: true,
            status: getFanPagesStatuses.FAN_PAGES_FETCHED,
            data: (response.pages ?? []).filter((item) => item?.id).map((item) => ({
                pageId: String(item.id),
                name: String(item.name ?? "Без назви"),
                pictureUrl: String(item.picture?.data?.url ?? ""),
            })),
        };
    } catch (error) {
        return { success: false, status: getFanPagesStatuses.ERROR, data: null, error: String(error?.message ?? error) };
    }
}
