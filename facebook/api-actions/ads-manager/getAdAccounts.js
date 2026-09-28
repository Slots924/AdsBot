const graphApiVersion = "v26.0";
const defaultTimeoutMs = 30000;


export const getBrowserAdAccountsStatuses = Object.freeze({
    ACCOUNTS_FETCHED: "ACCOUNTS_FETCHED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPH_API_ERROR: "GRAPH_API_ERROR",
    ERROR: "ERROR",
});


// Отримує рекламні акаунти через активну Facebook-сесію поточної вкладки.
// Токен і cookies використовуються тільки всередині browser context.
export default async function getAdAccounts({
    page,
    accessToken,
    timeout = defaultTimeoutMs,
}) {
    const token = String(accessToken ?? "").trim();
    const timeoutMs = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;
    if (!page || typeof page.evaluate !== "function" || !token) {
        return {
            success: false,
            status: getBrowserAdAccountsStatuses.INVALID_INPUT,
            data: null,
            error: !page ? "Не передано Puppeteer page" : "Потрібен accessToken",
        };
    }

    try {
        const response = await page.evaluate(async ({ tokenValue, version, requestTimeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeout);
            const accounts = [];
            let after = "";
            try {
                do {
                    const query = new URLSearchParams({
                        access_token: tokenValue,
                        fields: "id,account_id,name,account_status,disable_reason,currency,timezone_name",
                        limit: "100",
                    });
                    if (after) query.set("after", after);
                    const result = await fetch(
                        `https://graph.facebook.com/${version}/me/adaccounts?${query}`,
                        { credentials: "include", signal: controller.signal }
                    );
                    const body = await result.json().catch(() => null);
                    if (!result.ok || body?.error) {
                        return {
                            ok: false,
                            statusCode: result.status,
                            graphError: body?.error ?? null,
                        };
                    }
                    if (Array.isArray(body?.data)) accounts.push(...body.data);
                    after = String(body?.paging?.cursors?.after ?? "");
                    if (!body?.paging?.next) after = "";
                } while (after);
                return { ok: true, statusCode: 200, accounts };
            } catch (error) {
                return {
                    ok: false,
                    timeout: error?.name === "AbortError",
                    error: String(error?.message ?? error),
                };
            } finally {
                clearTimeout(timer);
            }
        }, { tokenValue: token, version: graphApiVersion, requestTimeout: timeoutMs });

        if (response?.timeout) {
            return { success: false, status: getBrowserAdAccountsStatuses.REQUEST_TIMEOUT, data: null };
        }
        if (response?.graphError) {
            return {
                success: false,
                status: getBrowserAdAccountsStatuses.GRAPH_API_ERROR,
                data: null,
                error: response.graphError.message ?? "Graph API повернув помилку",
                graphCode: response.graphError.code ?? null,
                graphSubcode: response.graphError.error_subcode ?? null,
                httpStatus: response.statusCode ?? null,
            };
        }
        if (!response?.ok) {
            return {
                success: false,
                status: getBrowserAdAccountsStatuses.HTTP_ERROR,
                data: null,
                error: response?.error ?? "Не вдалося отримати рекламні акаунти",
                httpStatus: response?.statusCode ?? null,
            };
        }

        return {
            success: true,
            status: getBrowserAdAccountsStatuses.ACCOUNTS_FETCHED,
            data: (response.accounts ?? []).filter((item) => item?.id).map((item) => ({
                id: String(item.id),
                accountId: String(item.account_id ?? String(item.id).replace(/^act_/, "")),
                name: String(item.name ?? "Без назви"),
                accountStatus: Number(item.account_status ?? 0),
                disableReason: item.disable_reason ?? null,
                currency: item.currency ?? null,
                timezoneName: item.timezone_name ?? null,
            })),
        };
    } catch (error) {
        return {
            success: false,
            status: getBrowserAdAccountsStatuses.ERROR,
            data: null,
            error: String(error?.message ?? error),
        };
    }
}
