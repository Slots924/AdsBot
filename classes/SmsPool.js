import axios from "axios";

import { getLogger } from "../services/logging/runtimeLogger.js";


const defaultApiUrl = "https://api.smspool.net";
const defaultTimeout = 30000;

export const smsPoolOrderStatuses = Object.freeze({
    PENDING: 1,
    EXPIRED: 2,
    COMPLETED: 3,
    RESEND: 4,
    CANCELLED: 5,
    REFUNDED: 6,
    PROCESSING: 7,
    ACTIVATING: 8,
});


function createSmsPoolError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function requireValue(value, label) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
        throw createSmsPoolError(`${label} не вказано`, "SMS_POOL_VALIDATION_ERROR");
    }
    return normalized;
}


function normalizeApiUrl(value) {
    const url = String(value ?? defaultApiUrl).trim().replace(/\/+$/, "");
    try {
        const parsed = new URL(url);
        if (!new Set(["http:", "https:"]).has(parsed.protocol)) {
            throw new Error("Непідтримуваний протокол");
        }
    } catch {
        throw createSmsPoolError(
            "SMS_POOL_API_URL містить некоректну URL-адресу",
            "SMS_POOL_CONFIG_ERROR"
        );
    }
    return url;
}


function extractErrorMessage(error) {
    const payload = error?.response?.data;
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim();
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
    return error?.message || "Невідома помилка SMSPool";
}


function toFormData(data = {}) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
        if (value === undefined || value === null || value === "") continue;
        form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    return form;
}


/**
 * Централізований клієнт SMSPool API для одноразових SMS-номерів.
 */
class SmsPool {
    constructor({
        apiToken = process.env.SMS_POOL_API_TOKEN,
        apiUrl = process.env.SMS_POOL_API_URL ?? defaultApiUrl,
        timeout = defaultTimeout,
        httpClient = axios,
    } = {}) {
        this.apiToken = String(apiToken ?? "").trim();
        this.apiUrl = normalizeApiUrl(apiUrl);
        this.timeout = Number.isFinite(Number(timeout)) && Number(timeout) > 0
            ? Number(timeout)
            : defaultTimeout;
        this.httpClient = httpClient;
    }


    ensureConfigured({ requiresToken = true } = {}) {
        if (requiresToken && !this.apiToken) {
            throw createSmsPoolError(
                "Не заповнено SMS_POOL_API_TOKEN у файлі .env",
                "SMS_POOL_CONFIG_ERROR"
            );
        }
        if (typeof this.httpClient?.request !== "function") {
            throw createSmsPoolError(
                "HTTP-клієнт SMSPool не містить методу request",
                "SMS_POOL_CONFIG_ERROR"
            );
        }
    }


    // Усі HTTP-запити до SMSPool проходять через цей метод.
    async request(method, endpoint, data = {}, { requiresToken = true } = {}) {
        this.ensureConfigured({ requiresToken });
        const path = `/${String(endpoint ?? "").replace(/^\/+/, "")}`;
        const logger = getLogger("sms-pool");
        const startedAt = Date.now();

        try {
            const response = await this.httpClient.request({
                method,
                url: `${this.apiUrl}${path}`,
                data: toFormData(requiresToken ? { ...data, key: this.apiToken } : data),
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
                timeout: this.timeout,
            });
            logger.debug("sms-pool.response", "SMSPool відповів", {
                method,
                endpoint: path,
                durationMs: Date.now() - startedAt,
                status: response.status,
            });
            return response.data ?? null;
        } catch (error) {
            const message = extractErrorMessage(error);
            logger.error("sms-pool.request.failed", "Запит до SMSPool завершився помилкою", {
                method,
                endpoint: path,
                durationMs: Date.now() - startedAt,
                status: error?.response?.status ?? null,
                error: message,
            });
            throw createSmsPoolError(message, "SMS_POOL_API_ERROR", {
                httpStatus: error?.response?.status ?? null,
            });
        }
    }


    listCountries() {
        return this.request("GET", "/country/retrieve_all", {}, { requiresToken: false });
    }


    listServices() {
        return this.request("GET", "/service/retrieve_all", {}, { requiresToken: false });
    }


    listPools() {
        return this.request("POST", "/pool/retrieve_all", {}, { requiresToken: false });
    }


    getBalance() {
        return this.request("POST", "/request/balance");
    }


    getPricing() {
        return this.request("POST", "/request/pricing");
    }


    getPrice({ country, service } = {}) {
        return this.request("POST", "/request/price", {
            country: requireValue(country, "Країну"),
            service: requireValue(service, "Сервіс"),
        });
    }


    purchaseSms({
        country,
        service,
        pool,
        maxPrice,
        pricingOption,
        quantity,
        areaCodes,
        excludeAreaCodes,
        activationType,
        carrier,
        createToken,
    } = {}) {
        return this.request("POST", "/purchase/sms", {
            country: requireValue(country, "Країну"),
            service: requireValue(service, "Сервіс"),
            pool,
            max_price: maxPrice,
            pricing_option: pricingOption,
            quantity,
            areacode: areaCodes,
            exclude: excludeAreaCodes ? 1 : undefined,
            activation_type: activationType,
            carrier,
            create_token: createToken ? 1 : undefined,
        });
    }


    checkSms(orderId) {
        return this.request("POST", "/sms/check", {
            orderid: requireValue(orderId, "ID замовлення"),
        });
    }


    getActiveSmsOrders() {
        return this.request("POST", "/request/active");
    }


    getSmsOrderHistory(params = {}) {
        return this.request("POST", "/request/history", params);
    }


    archiveSmsOrders() {
        return this.request("POST", "/request/archive");
    }


    getSmsStock({ country, service, pool } = {}) {
        return this.request("POST", "/sms/stock", {
            country: requireValue(country, "Країну"),
            service: requireValue(service, "Сервіс"),
            pool,
        });
    }


    cancelSms(orderId) {
        return this.request("POST", "/sms/cancel", {
            orderid: requireValue(orderId, "ID замовлення"),
        });
    }


    cancelAllSms() {
        return this.request("POST", "/sms/cancel_all");
    }


    clearSmsCache() {
        return this.request("POST", "/sms/clear_cache");
    }


    activateSms(orderId) {
        return this.request("POST", "/sms/activate", {
            orderid: requireValue(orderId, "ID замовлення"),
        });
    }


    reactivateSms(orderId) {
        return this.request("POST", "/sms/reactivate", {
            orderid: requireValue(orderId, "ID замовлення"),
        });
    }


    checkSmsResend(orderId) {
        return this.request("POST", "/sms/check_resend", {
            orderid: requireValue(orderId, "ID замовлення"),
        });
    }


    resendSms(orderId) {
        return this.request("POST", "/sms/resend", {
            orderid: requireValue(orderId, "ID замовлення"),
        });
    }
}


export default SmsPool;
