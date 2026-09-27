const graphApiVersion = "v26.0";
const defaultTimeoutMs = 30000;


export const getAdPixelsStatuses = Object.freeze({
    PIXELS_FETCHED: "PIXELS_FETCHED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPH_API_ERROR: "GRAPH_API_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує ID рекламного акаунта до формату Graph API.
function normalizeAdAccountId(value) {
    const normalized = String(value ?? "").trim();
    if (/^act_\d+$/.test(normalized)) return normalized;
    return /^\d+$/.test(normalized) ? `act_${normalized}` : null;
}


// Зчитує всі доступні Meta Pixel рекламного акаунта без зміни даних Meta.
// Access token використовується лише для browser-запитів і не повертається в результаті.
export default async function getAdPixels({
    page,
    accessToken,
    adAccountId,
    timeout = defaultTimeoutMs,
}) {
    const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
    const normalizedAccessToken = String(accessToken ?? "").trim();
    const normalizedTimeout = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;

    if (!page || typeof page.evaluate !== "function" || !normalizedAdAccountId
        || !normalizedAccessToken) {
        return {
            success: false,
            status: getAdPixelsStatuses.INVALID_INPUT,
            data: null,
            error: !page || typeof page.evaluate !== "function"
                ? "Не передано Puppeteer page"
                : (!normalizedAdAccountId
                    ? "Потрібен коректний adAccountId"
                    : "Потрібен accessToken"),
        };
    }

    try {
        const response = await page.evaluate(
            async ({ accountId, token, timeoutMs, version }) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                const pixels = [];
                let after = null;

                try {
                    do {
                        const query = new URLSearchParams({
                            fields: "id,name",
                            limit: "100",
                            access_token: token,
                            ...(after ? { after } : {}),
                        });
                        const fetchResponse = await fetch(
                            `https://graph.facebook.com/${version}/${accountId}/adspixels?${query}`,
                            {
                                method: "GET",
                                credentials: "include",
                                signal: controller.signal,
                            }
                        );
                        const body = await fetchResponse.text();
                        let data;
                        try {
                            data = JSON.parse(body);
                        } catch {
                            return {
                                ok: fetchResponse.ok,
                                statusCode: fetchResponse.status,
                                parseError: true,
                            };
                        }
                        if (data?.error) {
                            return {
                                ok: fetchResponse.ok,
                                statusCode: fetchResponse.status,
                                graphError: {
                                    code: data.error.code ?? null,
                                    subcode: data.error.error_subcode ?? null,
                                    type: data.error.type ?? null,
                                    message: data.error.message ?? null,
                                },
                            };
                        }
                        if (!fetchResponse.ok) {
                            return {
                                ok: false,
                                statusCode: fetchResponse.status,
                            };
                        }

                        if (Array.isArray(data?.data)) pixels.push(...data.data);
                        after = data?.paging?.next
                            ? data?.paging?.cursors?.after ?? null
                            : null;
                    } while (after);

                    return { ok: true, statusCode: 200, pixels };
                } catch (error) {
                    return {
                        requestError: error?.name === "AbortError"
                            ? "TIMEOUT"
                            : String(error?.message ?? error),
                    };
                } finally {
                    clearTimeout(timeoutId);
                }
            },
            {
                accountId: normalizedAdAccountId,
                token: normalizedAccessToken,
                timeoutMs: normalizedTimeout,
                version: graphApiVersion,
            }
        );

        if (response.requestError === "TIMEOUT") {
            return {
                success: false,
                status: getAdPixelsStatuses.REQUEST_TIMEOUT,
                data: null,
            };
        }
        if (response.requestError) {
            return {
                success: false,
                status: getAdPixelsStatuses.REQUEST_FAILED,
                data: null,
                error: response.requestError,
            };
        }
        if (response.parseError) {
            return {
                success: false,
                status: getAdPixelsStatuses.PARSE_ERROR,
                data: null,
                httpStatus: response.statusCode,
            };
        }
        if (response.graphError) {
            return {
                success: false,
                status: getAdPixelsStatuses.GRAPH_API_ERROR,
                data: null,
                httpStatus: response.statusCode,
                graphError: response.graphError,
            };
        }
        if (!response.ok) {
            return {
                success: false,
                status: getAdPixelsStatuses.HTTP_ERROR,
                data: null,
                httpStatus: response.statusCode,
            };
        }

        return {
            success: true,
            status: getAdPixelsStatuses.PIXELS_FETCHED,
            data: (response.pixels ?? [])
                .filter((pixel) => pixel?.id)
                .map((pixel) => ({
                    id: String(pixel.id),
                    name: String(pixel.name ?? ""),
                })),
            httpStatus: response.statusCode,
        };
    } catch (error) {
        return {
            success: false,
            status: getAdPixelsStatuses.ERROR,
            data: null,
            error: String(error?.message ?? error),
        };
    }
}
