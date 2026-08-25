import checkProxy from "./checkProxy.js";
import refreshProxyIp from "./refreshProxyIp.js";


function createAbortError() {
    return Object.assign(new Error("Очікування проксі воркера перервано"), {
        name: "AbortError",
        code: "COMMENTING_ABORTED",
    });
}


export default async function ensureWorkerProxyReady(proxy, {
    refreshProxyIpFn = refreshProxyIp,
    checkProxyFn = checkProxy,
    timeoutMs = 60000,
    signal,
} = {}) {
    if (signal?.aborted) throw createAbortError();

    if (String(proxy?.refreshUrl ?? "").trim()) {
        try {
            return await refreshProxyIpFn(proxy, { timeoutMs, signal });
        } catch (error) {
            if (error?.name === "AbortError") throw error;
            return {
                working: false,
                timedOut: false,
                ip: null,
                error: error.message,
            };
        }
    }

    let result;
    try {
        result = await checkProxyFn(proxy);
    } catch (error) {
        if (error?.name === "AbortError") throw error;
        return {
            working: false,
            timedOut: false,
            ip: null,
            error: error.message,
        };
    }

    return {
        working: Boolean(result?.working),
        timedOut: false,
        ip: result?.ip ?? null,
        error: result?.working ? null : result?.error ?? null,
    };
}
