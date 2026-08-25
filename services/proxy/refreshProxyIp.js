import axios from "axios";

import checkProxy from "./checkProxy.js";
import { createProxyError, normalizeRefreshUrl } from "./normalizeStoredProxy.js";


function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}


function createAbortError() {
    return Object.assign(new Error("Зміну IP проксі перервано"), {
        name: "AbortError",
        code: "COMMENTING_ABORTED",
    });
}


export default async function refreshProxyIp(proxy, {
    httpClient = axios,
    checkProxyFn = checkProxy,
    timeoutMs = 90000,
    pollIntervalMs = 3000,
    initialDelayMs = 3000,
    requestTimeoutMs = 15000,
    signal,
} = {}) {
    const assertNotAborted = () => {
        if (signal?.aborted) throw createAbortError();
    };
    assertNotAborted();
    const refreshUrl = normalizeRefreshUrl(proxy?.refreshUrl);
    if (!refreshUrl) {
        throw createProxyError(
            "Для цієї проксі немає посилання зміни IP",
            "PROXY_REFRESH_URL_MISSING"
        );
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw createProxyError(
            "Таймаут зміни IP має бути додатним числом",
            "PROXY_REFRESH_TIMEOUT_INVALID"
        );
    }

    try {
        await httpClient.get(refreshUrl, {
            timeout: requestTimeoutMs,
            proxy: false,
            validateStatus: () => true,
        });
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw createProxyError(
            "Не вдалося надіслати запит на зміну IP",
            "PROXY_REFRESH_REQUEST_FAILED"
        );
    }

    assertNotAborted();
    if (initialDelayMs > 0) {
        await wait(initialDelayMs);
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        assertNotAborted();
        let result;
        try {
            result = await checkProxyFn(proxy, { timeout: 5000 });
        } catch {
            result = { working: false };
        }

        if (result?.working) {
            return {
                working: true,
                timedOut: false,
                ip: result.ip ?? null,
            };
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await wait(Math.min(pollIntervalMs, remaining));
    }

    return {
        working: false,
        timedOut: true,
        ip: null,
    };
}
