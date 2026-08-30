import axios from "axios";

import { getLogger } from "../services/logging/runtimeLogger.js";


function createKeitaroError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function requireId(value, label) {
    const id = String(value ?? "").trim();
    if (!id) {
        throw createKeitaroError(
            `${label} не вказано`,
            "KEITARO_VALIDATION_ERROR"
        );
    }
    return id;
}


function normalizeBaseUrl(value) {
    const apiUrl = String(value ?? "").trim();
    if (!apiUrl) return "";

    let parsedUrl;
    try {
        parsedUrl = new URL(apiUrl);
    } catch {
        throw createKeitaroError(
            "KEITARO_API_URL містить некоректну URL-адресу",
            "KEITARO_CONFIG_ERROR"
        );
    }

    if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
        throw createKeitaroError(
            "KEITARO_API_URL має використовувати HTTP або HTTPS",
            "KEITARO_CONFIG_ERROR"
        );
    }

    return apiUrl
        .replace(/\/+$/, "")
        .replace(/\/admin_api\/v1$/i, "");
}


function extractErrorMessage(error) {
    const payload = error?.response?.data;
    if (typeof payload === "string" && payload.trim()) {
        return payload.trim();
    }
    if (typeof payload?.error === "string" && payload.error.trim()) {
        return payload.error.trim();
    }
    if (typeof payload?.message === "string" && payload.message.trim()) {
        return payload.message.trim();
    }
    if (payload && typeof payload === "object") {
        const details = Object.entries(payload)
            .flatMap(([field, messages]) => (Array.isArray(messages) ? messages : [messages])
                .filter((message) => typeof message === "string" && message.trim())
                .map((message) => `${field}: ${message.trim()}`))
            .join("; ");
        if (details) return details.slice(0, 2000);
    }
    return error?.message || "Невідома помилка Keitaro";
}


const defaultConcurrency = 20;
const minConcurrency = 1;
const maxConcurrency = 50;
const maxRateLimitRetries = 6;


function normalizeConcurrency(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return defaultConcurrency;
    return Math.min(maxConcurrency, Math.max(minConcurrency, number));
}


function retryAfterMs(error) {
    const header = error?.response?.headers?.["retry-after"]
        ?? error?.response?.headers?.["Retry-After"];
    if (header === undefined || header === null || header === "") return null;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(60000, seconds * 1000);
    }
    return null;
}


function normalizeList(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.streams)) return payload.streams;
    if (Array.isArray(payload?.list)) return payload.list;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.rows)) return payload.rows;
    return [];
}


function streamPayloadFromTemplate(stream = {}) {
    const payload = structuredClone(stream ?? {});
    for (const key of [
        "id",
        "campaign_id",
        "campaignId",
        "position",
        "created_at",
        "updated_at",
        "is_monitoring",
        "monitoring_url",
    ]) {
        delete payload[key];
    }
    payload.landings = normalizeList(payload.landings).map((landing) => ({
        landing_id: Number(landing?.landing_id ?? landing?.id),
        share: Number.isFinite(Number(landing?.share)) ? Number(landing.share) : 100,
        state: landing?.state === "disabled" ? "disabled" : "active",
    })).filter((landing) => Number.isInteger(landing.landing_id) && landing.landing_id > 0);
    payload.offers = normalizeList(payload.offers).map((offer) => ({
        offer_id: Number(offer?.offer_id ?? offer?.id),
        share: Number.isFinite(Number(offer?.share)) ? Number(offer.share) : 100,
        state: offer?.state === "disabled" ? "disabled" : "active",
    })).filter((offer) => Number.isInteger(offer.offer_id) && offer.offer_id > 0);
    payload.filters = normalizeList(payload.filters).map((filter) => {
        const item = structuredClone(filter);
        for (const key of ["id", "stream_id", "oid", "created_at", "updated_at"]) {
            delete item[key];
        }
        return item;
    });
    payload.triggers = normalizeList(payload.triggers).map((trigger) => {
        const item = structuredClone(trigger);
        for (const key of ["id", "stream_id", "oid", "created_at", "updated_at", "next_run_at"]) {
            delete item[key];
        }
        return item;
    });
    return payload;
}


class Keitaro {
    constructor({
        apiKey = process.env.KEITARO_API_KEY,
        apiUrl = process.env.KEITARO_API_URL,
        timeout = 60000,
        concurrency = defaultConcurrency,
        rateLimitRetries = maxRateLimitRetries,
        retryOnRateLimit = false,
        httpClient = axios,
    } = {}) {
        this.apiKey = String(apiKey ?? "").trim();
        this.rawApiUrl = String(apiUrl ?? "").trim();
        this.apiUrl = "";
        this.timeout = Number.isFinite(timeout) && timeout > 0
            ? timeout
            : 60000;
        this.concurrency = normalizeConcurrency(concurrency);
        this.rateLimitRetries = Number.isFinite(Number(rateLimitRetries))
            && Number(rateLimitRetries) > 0
            ? Math.round(Number(rateLimitRetries))
            : maxRateLimitRetries;
        this.retryOnRateLimit = Boolean(retryOnRateLimit);
        this.httpClient = httpClient;
        this.activeRequests = 0;
        this.concurrencyWaiters = [];
    }


    async wait(milliseconds) {
        return new Promise((resolve) => {
            setTimeout(resolve, milliseconds);
        });
    }


    setConcurrency(value) {
        this.concurrency = normalizeConcurrency(value);
        while (
            this.activeRequests < this.concurrency
            && this.concurrencyWaiters.length > 0
        ) {
            const next = this.concurrencyWaiters.shift();
            if (next) next();
        }
        return this.concurrency;
    }


    async runLimited(operation) {
        if (this.activeRequests >= this.concurrency) {
            await new Promise((resolve) => {
                this.concurrencyWaiters.push(resolve);
            });
        }
        this.activeRequests += 1;
        try {
            return await operation();
        } finally {
            this.activeRequests = Math.max(0, this.activeRequests - 1);
            const next = this.concurrencyWaiters.shift();
            if (next) next();
        }
    }


    ensureConfigured() {
        if (!this.apiUrl && this.rawApiUrl) {
            this.apiUrl = normalizeBaseUrl(this.rawApiUrl);
        }
        if (!this.apiUrl || !this.apiKey) {
            throw createKeitaroError(
                "Не заповнено KEITARO_API_URL або KEITARO_API_KEY у файлі .env",
                "KEITARO_CONFIG_ERROR"
            );
        }
        if (typeof this.httpClient?.request !== "function") {
            throw createKeitaroError(
                "HTTP-клієнт Keitaro не містить метод request",
                "KEITARO_CONFIG_ERROR"
            );
        }
    }


    // Усі запити до Keitaro проходять через цей метод
    async request(method, endpoint, data = null, params = null, options = {}) {
        const sendRequest = async () => {
            this.ensureConfigured();
            const logger = getLogger("keitaro");
            const path = String(endpoint ?? "");
            const url = options.url || `${this.apiUrl}/admin_api/v1${
                path.startsWith("/") ? path : `/${path}`
            }`;

            for (let attempt = 1; ; attempt += 1) {
                const startedAt = Date.now();
                logger.debug("keitaro.request", "Надсилаємо запит до Keitaro", {
                    method,
                    endpoint: path,
                    attempt,
                });
                try {
                    const response = await this.httpClient.request({
                        method,
                        url,
                        data,
                        params,
                        headers: {
                            "Api-Key": this.apiKey,
                            "Content-Type": "application/json",
                            Accept: "application/json",
                        },
                        timeout: this.timeout,
                    });
                    logger.debug("keitaro.response", "Keitaro відповів", {
                        method,
                        endpoint: path,
                        durationMs: Date.now() - startedAt,
                        status: response.status,
                    });
                    return response.data ?? null;
                } catch (error) {
                    const status = error?.response?.status ?? null;
                    if (
                        this.retryOnRateLimit
                        && status === 429
                        && attempt <= this.rateLimitRetries
                    ) {
                        const waitMs = retryAfterMs(error)
                            ?? Math.min(15000, 1000 * (2 ** (attempt - 1)));
                        logger.warn(
                            "keitaro.rate-limit",
                            "Keitaro просить зачекати (429). Повторимо запит.",
                            {
                                method,
                                endpoint: path,
                                attempt,
                                waitMs,
                            }
                        );
                        await this.wait(waitMs);
                        continue;
                    }
                    const message = extractErrorMessage(error);
                    logger.error(
                        "keitaro.request.failed",
                        "Запит до Keitaro завершився помилкою",
                        {
                            method,
                            endpoint: path,
                            durationMs: Date.now() - startedAt,
                            status,
                            error: message,
                        }
                    );
                    throw createKeitaroError(message, "KEITARO_API_ERROR", {
                        httpStatus: status,
                    });
                }
            }
        };

        return this.runLimited(sendRequest);
    }


    sendBatch(operations) {
        if (!Array.isArray(operations) || operations.length === 0) {
            throw createKeitaroError(
                "Для batch потрібен непорожній масив запитів",
                "KEITARO_VALIDATION_ERROR"
            );
        }
        this.ensureConfigured();
        return this.request(
            "POST",
            "/?batch",
            operations,
            null,
            { url: `${this.apiUrl}/admin_api/v1/?batch` }
        );
    }


    async listAll(resource, params = {}) {
        const limit = Number(params.limit) > 0 ? Number(params.limit) : 100;
        let offset = Number(params.offset) > 0 ? Number(params.offset) : 0;
        const all = [];

        for (;;) {
            const page = normalizeList(await this.request(
                "GET",
                `/${resource}`,
                null,
                { ...params, limit, offset }
            ));
            all.push(...page);
            if (page.length < limit || all.length >= 20000) break;
            offset += limit;
        }

        return all;
    }


    // Campaigns
    listCampaigns(params = {}) {
        return this.request("GET", "/campaigns", null, params);
    }

    listAllCampaigns(params = {}) {
        return this.listAll("campaigns", params);
    }

    getCampaign(id) {
        return this.request(
            "GET",
            `/campaigns/${requireId(id, "ID кампанії")}`
        );
    }

    createCampaign(data) {
        return this.request("POST", "/campaigns", data ?? {});
    }

    updateCampaign(id, data) {
        return this.request(
            "PUT",
            `/campaigns/${requireId(id, "ID кампанії")}`,
            data ?? {}
        );
    }

    deleteCampaign(id) {
        return this.request(
            "DELETE",
            `/campaigns/${requireId(id, "ID кампанії")}`
        );
    }

    cloneCampaign(id, data = {}) {
        return this.request(
            "POST",
            `/campaigns/${requireId(id, "ID кампанії")}/clone`,
            data
        );
    }

    restoreCampaign(id) {
        return this.request(
            "POST",
            `/campaigns/${requireId(id, "ID кампанії")}/restore`
        );
    }

    getCampaignStreams(id) {
        return this.request(
            "GET",
            `/campaigns/${requireId(id, "ID кампанії")}/streams`
        );
    }


    async applyStreamTemplateToCampaigns({
        campaignIds = [],
        stream,
        mode = "add",
        replacePosition = null,
    } = {}) {
        const ids = [...new Set(normalizeList(campaignIds)
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0))];
        if (ids.length === 0) {
            throw createKeitaroError(
                "Потрібно вибрати хоча б одну кампанію",
                "KEITARO_VALIDATION_ERROR"
            );
        }
        if (!stream || typeof stream !== "object") {
            throw createKeitaroError(
                "Шаблон потоку порожній",
                "KEITARO_VALIDATION_ERROR"
            );
        }
        const normalizedMode = mode === "replace" ? "replace" : "add";
        const position = Number(replacePosition);
        if (normalizedMode === "replace" && (!Number.isInteger(position) || position < 1)) {
            throw createKeitaroError(
                "Для заміни вкажіть номер потоку в кампанії",
                "KEITARO_VALIDATION_ERROR"
            );
        }
        const payload = streamPayloadFromTemplate(stream);

        let operations;
        if (normalizedMode === "replace") {
            const streamLists = await Promise.allSettled(
                ids.map((campaignId) => this.getCampaignStreams(campaignId))
            );
            operations = ids.map((campaignId, index) => {
                const response = streamLists[index];
                if (response.status === "rejected") {
                    return Promise.reject(response.reason);
                }
                const streams = normalizeList(response.value);
                const target = streams.find((item) => Number(item?.position) === position)
                    ?? streams[position - 1];
                if (!target?.id) {
                    return Promise.reject(createKeitaroError(
                        `У кампанії ${campaignId} немає потоку №${position}`,
                        "KEITARO_STREAM_NOT_FOUND",
                        { campaignId, replacePosition: position }
                    ));
                }
                return this.updateStream(target.id, {
                    ...payload,
                    campaign_id: campaignId,
                    position: Number(target.position) || position,
                });
            });
        } else {
            operations = ids.map((campaignId) => this.createStream({
                ...payload,
                campaign_id: campaignId,
            }));
        }

        const settled = await Promise.allSettled(operations);
        return settled.map((result, index) => ({
            campaignId: ids[index],
            ok: result.status === "fulfilled",
            ...(result.status === "fulfilled"
                ? { stream: result.value }
                : { error: extractErrorMessage(result.reason) }),
        }));
    }

    updateCampaignCosts(id, data) {
        return this.request(
            "POST",
            `/campaigns/${requireId(id, "ID кампанії")}/update_costs`,
            data ?? {}
        );
    }

    enableCampaign(id) {
        return this.updateCampaign(id, { state: "active" });
    }

    disableCampaign(id) {
        return this.updateCampaign(id, { state: "disabled" });
    }


    // Групи кампаній у цьому Keitaro — це /groups?type=campaigns
    listCampaignGroups(params = {}) {
        return this.request("GET", "/groups", null, {
            ...params,
            type: "campaigns",
        });
    }

    async listAllCampaignGroups(params = {}) {
        return normalizeList(await this.listCampaignGroups(params));
    }

    async getCampaignGroup(id) {
        const groupId = requireId(id, "ID групи кампаній");
        const found = (await this.listAllCampaignGroups()).find(
            (group) => String(group?.id) === groupId
        );
        if (!found) {
            throw createKeitaroError(
                `Групу кампаній ${groupId} не знайдено`,
                "KEITARO_API_ERROR",
                { httpStatus: 404 }
            );
        }
        return found;
    }

    createCampaignGroup(data) {
        return this.request("POST", "/groups", {
            ...(data ?? {}),
            type: "campaigns",
        });
    }

    updateCampaignGroup(id, data) {
        return this.request(
            "PUT",
            `/groups/${requireId(id, "ID групи кампаній")}`,
            {
                ...(data ?? {}),
                type: "campaigns",
            }
        );
    }

    deleteCampaignGroup(id) {
        return this.request(
            "DELETE",
            `/groups/${requireId(id, "ID групи кампаній")}`
        );
    }


    // Offers
    listOffers(params = {}) {
        return this.request("GET", "/offers", null, params);
    }

    listAllOffers(params = {}) {
        return this.listOffers(params).then(normalizeList);
    }

    getOffer(id) {
        return this.request("GET", `/offers/${requireId(id, "ID офера")}`);
    }

    createOffer(data) {
        return this.request("POST", "/offers", data ?? {});
    }

    updateOffer(id, data) {
        return this.request(
            "PUT",
            `/offers/${requireId(id, "ID офера")}`,
            data ?? {}
        );
    }

    deleteOffer(id) {
        return this.request(
            "DELETE",
            `/offers/${requireId(id, "ID офера")}`
        );
    }


    // Landings
    listLandings(params = {}) {
        return this.request("GET", "/landing_pages", null, params);
    }

    listAllLandings(params = {}) {
        return this.listLandings(params).then(normalizeList);
    }

    listStreamFilters(params = {}) {
        return this.request("GET", "/stream_filters", null, params);
    }

    getLanding(id) {
        return this.request(
            "GET",
            `/landing_pages/${requireId(id, "ID лендінгу")}`
        );
    }

    createLanding(data) {
        return this.request("POST", "/landing_pages", data ?? {});
    }

    updateLanding(id, data) {
        return this.request(
            "PUT",
            `/landing_pages/${requireId(id, "ID лендінгу")}`,
            data ?? {}
        );
    }

    deleteLanding(id) {
        return this.request(
            "DELETE",
            `/landing_pages/${requireId(id, "ID лендінгу")}`
        );
    }


    // Streams
    listStreams(params = {}) {
        return this.request("GET", "/streams", null, params);
    }

    listAllStreams(params = {}) {
        return this.listAll("streams", params);
    }

    getStream(id) {
        return this.request("GET", `/streams/${requireId(id, "ID потоку")}`);
    }

    createStream(data) {
        return this.request("POST", "/streams", data ?? {});
    }

    updateStream(id, data) {
        return this.request(
            "PUT",
            `/streams/${requireId(id, "ID потоку")}`,
            data ?? {}
        );
    }

    deleteStream(id) {
        return this.request(
            "DELETE",
            `/streams/${requireId(id, "ID потоку")}`
        );
    }


    // Traffic sources
    listTrafficSources(params = {}) {
        return this.request("GET", "/traffic_sources", null, params);
    }

    listAllTrafficSources(params = {}) {
        return this.listAll("traffic_sources", params);
    }

    getTrafficSource(id) {
        return this.request(
            "GET",
            `/traffic_sources/${requireId(id, "ID джерела трафіку")}`
        );
    }

    createTrafficSource(data) {
        return this.request("POST", "/traffic_sources", data ?? {});
    }

    updateTrafficSource(id, data) {
        return this.request(
            "PUT",
            `/traffic_sources/${requireId(id, "ID джерела трафіку")}`,
            data ?? {}
        );
    }

    deleteTrafficSource(id) {
        return this.request(
            "DELETE",
            `/traffic_sources/${requireId(id, "ID джерела трафіку")}`
        );
    }


    // Affiliate networks
    listAffiliateNetworks(params = {}) {
        return this.request("GET", "/affiliate_networks", null, params);
    }

    listAllAffiliateNetworks(params = {}) {
        return this.listAll("affiliate_networks", params);
    }

    getAffiliateNetwork(id) {
        return this.request(
            "GET",
            `/affiliate_networks/${requireId(id, "ID партнерки")}`
        );
    }

    createAffiliateNetwork(data) {
        return this.request("POST", "/affiliate_networks", data ?? {});
    }

    updateAffiliateNetwork(id, data) {
        return this.request(
            "PUT",
            `/affiliate_networks/${requireId(id, "ID партнерки")}`,
            data ?? {}
        );
    }

    deleteAffiliateNetwork(id) {
        return this.request(
            "DELETE",
            `/affiliate_networks/${requireId(id, "ID партнерки")}`
        );
    }


    // Domains
    listDomains(params = {}) {
        return this.request("GET", "/domains", null, params);
    }

    listAllDomains(params = {}) {
        return this.listAll("domains", params);
    }

    getDomain(id) {
        return this.request("GET", `/domains/${requireId(id, "ID домену")}`);
    }

    createDomain(data) {
        return this.request("POST", "/domains", data ?? {});
    }

    updateDomain(id, data) {
        return this.request(
            "PUT",
            `/domains/${requireId(id, "ID домену")}`,
            data ?? {}
        );
    }

    deleteDomain(id) {
        return this.request(
            "DELETE",
            `/domains/${requireId(id, "ID домену")}`
        );
    }


    // Groups (офери / лендінги)
    listGroups(params = {}) {
        return this.request("GET", "/groups", null, params);
    }

    listAllGroups(params = {}) {
        return this.listAll("groups", params);
    }

    getGroup(id) {
        return this.request("GET", `/groups/${requireId(id, "ID групи")}`);
    }

    createGroup(data) {
        return this.request("POST", "/groups", data ?? {});
    }

    updateGroup(id, data) {
        return this.request(
            "PUT",
            `/groups/${requireId(id, "ID групи")}`,
            data ?? {}
        );
    }

    deleteGroup(id) {
        return this.request(
            "DELETE",
            `/groups/${requireId(id, "ID групи")}`
        );
    }


    // Users
    listUsers(params = {}) {
        return this.request("GET", "/users", null, params);
    }

    listAllUsers(params = {}) {
        return this.listAll("users", params);
    }

    getUser(id) {
        return this.request("GET", `/users/${requireId(id, "ID користувача")}`);
    }

    createUser(data) {
        return this.request("POST", "/users", data ?? {});
    }

    updateUser(id, data) {
        return this.request(
            "PUT",
            `/users/${requireId(id, "ID користувача")}`,
            data ?? {}
        );
    }

    deleteUser(id) {
        return this.request(
            "DELETE",
            `/users/${requireId(id, "ID користувача")}`
        );
    }


    // Conversions
    listConversions(params = {}) {
        return this.request("GET", "/conversions", null, params);
    }

    getConversion(id) {
        return this.request(
            "GET",
            `/conversions/${requireId(id, "ID конверсії")}`
        );
    }

    createConversion(data) {
        return this.request("POST", "/conversions", data ?? {});
    }

    updateConversion(id, data) {
        return this.request(
            "PUT",
            `/conversions/${requireId(id, "ID конверсії")}`,
            data ?? {}
        );
    }


    // Clicks
    getClick(id) {
        return this.request("GET", `/clicks/${requireId(id, "ID кліка")}`);
    }

    logClicks(data) {
        return this.request("POST", "/clicks/log", data ?? {});
    }

    updateClicks(data) {
        return this.request("POST", "/clicks/update", data ?? {});
    }


    // Report
    buildReport(payload) {
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            throw createKeitaroError(
                "Для звіту Keitaro потрібен об'єкт із range, dimensions і metrics",
                "KEITARO_VALIDATION_ERROR"
            );
        }
        return this.request("POST", "/report/build", payload);
    }
}


export default Keitaro;
export { createKeitaroError, normalizeConcurrency, normalizeList };
