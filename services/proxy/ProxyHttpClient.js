import axios from "axios";

import checkProxy from "./checkProxy.js";
import createProxyAgent from "./createProxyAgent.js";


const supportedProxyTypes = new Set([
    "socks5",
    "http",
    "https",
]);

const connectionErrorCodes = new Set([
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ESOCKETTIMEDOUT",
    "ETIMEDOUT",
    "ERR_NETWORK",
    "ERR_SOCKET_CONNECTION_TIMEOUT",
]);


function normalizeProxies(proxies) {
    if (!Array.isArray(proxies) || proxies.length === 0) {
        throw new Error("Пул проксі не може бути порожнім");
    }

    const seenIds = new Set();

    return proxies.map((proxy, index) => {
        const id = String(proxy?.id ?? "").trim();
        const type = String(proxy?.type ?? "")
            .trim()
            .toLowerCase();
        const host = String(proxy?.host ?? "").trim();
        const port = String(proxy?.port ?? "").trim();

        if (!id) {
            throw new Error(
                `Проксі ${index + 1} не містить id`
            );
        }

        if (seenIds.has(id)) {
            throw new Error(`ID проксі "${id}" дублюється`);
        }

        if (!supportedProxyTypes.has(type)) {
            throw new Error(
                `Тип проксі "${type}" не підтримується`
            );
        }

        if (!host || !port) {
            throw new Error(
                `Проксі "${id}" не містить host або port`
            );
        }

        const numericPort = Number(port);

        if (
            !Number.isInteger(numericPort)
            || numericPort < 1
            || numericPort > 65535
        ) {
            throw new Error(
                `Проксі "${id}" містить некоректний port`
            );
        }

        seenIds.add(id);

        return {
            id,
            type,
            host,
            port,
            username: String(proxy?.username ?? ""),
            password: String(proxy?.password ?? ""),
        };
    });
}


function isConnectionError(error) {
    if (error?.code === "ERR_CANCELED") {
        return false;
    }

    if (error?.response?.status === 407) {
        return true;
    }

    if (error?.response) {
        return false;
    }

    return connectionErrorCodes.has(error?.code)
        || Boolean(error?.request);
}


function createPoolExhaustedError() {
    const error = new Error(
        "Не вдалося знайти робочу проксі"
    );
    error.code = "PROXY_POOL_EXHAUSTED";
    return error;
}


export default class ProxyHttpClient {
    #proxies;


    constructor({
        proxies,
        proxyCheckTimeout = 5000,
        httpClient = axios,
        checkProxyFn = checkProxy,
    }) {
        if (
            !Number.isFinite(proxyCheckTimeout)
            || proxyCheckTimeout <= 0
        ) {
            throw new Error(
                "Timeout перевірки проксі має бути додатним числом"
            );
        }

        if (typeof httpClient?.request !== "function") {
            throw new Error("HTTP-клієнт не містить метод request");
        }

        if (typeof checkProxyFn !== "function") {
            throw new Error("checkProxyFn має бути функцією");
        }

        this.#proxies = normalizeProxies(proxies);
        this.proxyCheckTimeout = proxyCheckTimeout;
        this.httpClient = httpClient;
        this.checkProxy = checkProxyFn;
        this.activeProxyIndex = 0;
        this.failoverPromise = null;
    }


    async #send(config, proxyIndex) {
        const proxy = this.#proxies[proxyIndex];
        const proxyAgent = createProxyAgent(proxy);

        return this.httpClient.request({
            ...config,
            httpAgent: proxyAgent,
            httpsAgent: proxyAgent,
            proxy: false,
        });
    }


    async #findWorkingProxy(failedProxyIndex) {
        for (
            let offset = 1;
            offset < this.#proxies.length;
            offset += 1
        ) {
            const candidateIndex =
                (failedProxyIndex + offset) % this.#proxies.length;
            const candidate = this.#proxies[candidateIndex];
            let result;

            try {
                result = await this.checkProxy(candidate, {
                    timeout: this.proxyCheckTimeout,
                });
            } catch {
                result = { working: false };
            }

            if (result.working) {
                this.activeProxyIndex = candidateIndex;
                return;
            }
        }

        throw createPoolExhaustedError();
    }


    async #switchProxy(failedProxyIndex) {
        if (this.activeProxyIndex !== failedProxyIndex) {
            if (this.failoverPromise) {
                await this.failoverPromise;
            }

            return;
        }

        if (!this.failoverPromise) {
            this.failoverPromise = this.#findWorkingProxy(
                failedProxyIndex
            ).finally(() => {
                this.failoverPromise = null;
            });
        }

        await this.failoverPromise;
    }


    /**
     * Виконує HTTP-запит через активну проксі.
     * Після проблеми з'єднання перемикає проксі та повторює запит один раз.
     * @param {import("axios").AxiosRequestConfig} config Налаштування Axios.
     * @returns {Promise<import("axios").AxiosResponse>}
     * @throws {Error} Помилка з code=PROXY_POOL_EXHAUSTED, якщо пул вичерпано.
     */
    async request(config) {
        if (!config || !String(config.url ?? "").trim()) {
            throw new Error("Не вказано URL HTTP-запиту");
        }

        const failedProxyIndex = this.activeProxyIndex;

        try {
            return await this.#send(config, failedProxyIndex);
        } catch (error) {
            if (!isConnectionError(error)) {
                throw error;
            }
        }

        await this.#switchProxy(failedProxyIndex);

        return this.#send(config, this.activeProxyIndex);
    }


    /**
     * Виконує GET-запит через активну проксі.
     * @param {string} url URL запиту.
     * @param {import("axios").AxiosRequestConfig} config Налаштування Axios.
     * @returns {Promise<import("axios").AxiosResponse>}
     */
    async get(url, config = {}) {
        return this.request({
            ...config,
            method: "get",
            url,
        });
    }
}
