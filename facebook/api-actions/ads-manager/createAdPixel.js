const graphApiVersion = "v26.0";
const defaultTimeoutMs = 30000;


export const createAdPixelStatuses = Object.freeze({
    CREATED: "CREATED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPH_API_ERROR: "GRAPH_API_ERROR",
    CREATE_RESULT_NOT_FOUND: "CREATE_RESULT_NOT_FOUND",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує ID рекламного акаунта до формату Graph API.
function normalizeAdAccountId(value) {
    const normalized = String(value ?? "").trim();
    if (/^act_\d+$/.test(normalized)) return normalized;
    return /^\d+$/.test(normalized) ? `act_${normalized}` : null;
}


// Створює Meta Pixel у контексті активної browser-сесії через переданий access token.
// Access token використовується лише всередині запиту й ніколи не повертається або не логується.
export default async function createAdPixel({
    page,
    accessToken,
    adAccountId,
    name,
    timeout = defaultTimeoutMs,
}) {
    const normalizedAdAccountId = normalizeAdAccountId(adAccountId);
    const normalizedName = String(name ?? "").trim();
    const normalizedAccessToken = String(accessToken ?? "").trim();
    const normalizedTimeout = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;

    if (!page || typeof page.evaluate !== "function" || !normalizedAdAccountId
        || !normalizedName || !normalizedAccessToken) {
        return {
            success: false,
            status: createAdPixelStatuses.INVALID_INPUT,
            data: null,
            error: !page || typeof page.evaluate !== "function"
                ? "Не передано Puppeteer page"
                : (!normalizedAdAccountId
                    ? "Потрібен коректний adAccountId"
                    : (!normalizedName
                        ? "Потрібна непорожня назва Pixel"
                        : "Потрібен accessToken")),
        };
    }

    try {
        const response = await page.evaluate(
            async ({ accountId, pixelName, token, timeoutMs, version }) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

                try {
                    const fetchResponse = await fetch(
                        `https://graph.facebook.com/${version}/${accountId}/adspixels`,
                        {
                            method: "POST",
                            credentials: "include",
                            headers: {
                                "content-type": "application/x-www-form-urlencoded",
                            },
                            body: new URLSearchParams({
                                name: pixelName,
                                access_token: token,
                            }).toString(),
                            signal: controller.signal,
                        }
                    );

                    return {
                        ok: fetchResponse.ok,
                        statusCode: fetchResponse.status,
                        body: await fetchResponse.text(),
                    };
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
                pixelName: normalizedName,
                token: normalizedAccessToken,
                timeoutMs: normalizedTimeout,
                version: graphApiVersion,
            }
        );

        if (response.requestError === "TIMEOUT") {
            return {
                success: false,
                status: createAdPixelStatuses.REQUEST_TIMEOUT,
                data: null,
            };
        }
        if (response.requestError) {
            return {
                success: false,
                status: createAdPixelStatuses.REQUEST_FAILED,
                data: null,
                error: response.requestError,
            };
        }

        let data;
        try {
            data = JSON.parse(response.body);
        } catch {
            return {
                success: false,
                status: createAdPixelStatuses.PARSE_ERROR,
                data: null,
                httpStatus: response.statusCode,
            };
        }

        if (data?.error) {
            return {
                success: false,
                status: createAdPixelStatuses.GRAPH_API_ERROR,
                data: null,
                httpStatus: response.statusCode,
                graphError: {
                    code: data.error.code ?? null,
                    subcode: data.error.error_subcode ?? null,
                    type: data.error.type ?? null,
                    message: data.error.message ?? null,
                },
            };
        }
        if (!response.ok) {
            return {
                success: false,
                status: createAdPixelStatuses.HTTP_ERROR,
                data: null,
                httpStatus: response.statusCode,
            };
        }

        const pixelId = data?.id ?? null;
        if (!pixelId) {
            return {
                success: false,
                status: createAdPixelStatuses.CREATE_RESULT_NOT_FOUND,
                data: null,
                httpStatus: response.statusCode,
            };
        }

        return {
            success: true,
            status: createAdPixelStatuses.CREATED,
            data: {
                id: String(pixelId),
                name: normalizedName,
                adAccountId: normalizedAdAccountId,
            },
            httpStatus: response.statusCode,
        };
    } catch (error) {
        return {
            success: false,
            status: createAdPixelStatuses.ERROR,
            data: null,
            error: String(error?.message ?? error),
        };
    }
}
