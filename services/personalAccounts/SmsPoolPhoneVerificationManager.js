import { smsPoolOrderStatuses } from "../../classes/SmsPool.js";


const facebookSmsPoolService = "Facebook / Meta Viewpoints";
const defaultPollingIntervalMs = 5000;
const maxHistoryItems = 5;
const countryCallingCodes = Object.freeze({
    AE: "971", AU: "61", BR: "55", CN: "86", CZ: "420", DE: "49", ES: "34",
    FR: "33", GB: "44", HU: "36", ID: "62", IL: "972", IN: "91", IT: "39",
    JP: "81", KR: "82", MX: "52", NL: "31", PH: "63", PL: "48", RO: "40",
    RU: "7", SG: "65", SK: "421", TH: "66", TR: "90", UA: "380", US: "1",
    VN: "84",
});


function managerError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function asArray(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["data", "countries", "history", "orders", "items"]) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
}


function normalizeCountries(payload, catalog = []) {
    const catalogByName = new Map(catalog.flatMap((item) => [
        [String(item.name).trim().toLowerCase(), item.code],
        ...(item.aliases ?? []).map((alias) => [String(alias).trim().toLowerCase(), item.code]),
    ]));
    catalogByName.set("usa", "US");
    catalogByName.set("united states of america", "US");
    catalogByName.set("uk", "GB");
    const countries = asArray(payload).map((item) => {
        const name = String(item?.name ?? item?.country ?? "").trim();
        const explicitIso = String(
            item?.short_name ?? item?.shortName ?? item?.short_code ?? item?.iso ?? item?.code ?? ""
        ).trim().toUpperCase();
        const iso = /^[A-Z]{2}$/.test(explicitIso)
            ? explicitIso
            : String(catalogByName.get(name.toLowerCase()) ?? "");
        const id = String(item?.id ?? item?.ID ?? item?.country_id ?? iso).trim();
        const dialingCode = String(
            item?.cc ?? item?.dialing_code ?? item?.dial_code ?? item?.prefix ?? ""
        ).replace(/\D/g, "") || countryCallingCodes[iso] || "";
        return {
            id: id || iso,
            iso,
            name: name || iso,
            dialingCode,
        };
    }).filter((item) => item.id && item.iso && item.name);

    return countries.sort((left, right) => {
        if (left.iso === "US") return -1;
        if (right.iso === "US") return 1;
        return left.name.localeCompare(right.name);
    });
}


function normalizeBalance(payload) {
    const value = payload?.balance ?? payload?.amount ?? payload?.data ?? payload;
    const balance = Number(value);
    return Number.isFinite(balance) ? balance : null;
}


function normalizeOrder(item) {
    const code = String(item?.sms || item?.code || "").trim();
    const rawNumber = String(
        item?.number ?? item?.phonenumber ?? item?.phone_number ?? ""
    ).replace(/[^\d+]/g, "");
    const dialingCode = String(item?.cc ?? "").replace(/\D/g, "");
    const phone = rawNumber.startsWith("+")
        ? rawNumber
        : `+${dialingCode && !rawNumber.startsWith(dialingCode) ? dialingCode : ""}${rawNumber}`;
    return {
        orderId: String(item?.order_id ?? item?.order_code ?? item?.id ?? ""),
        phone,
        code: code && code !== "0" ? code : "",
        fullSms: String(item?.full_sms ?? item?.full_code ?? ""),
        country: String(item?.short_name ?? item?.country ?? ""),
        service: String(item?.service ?? facebookSmsPoolService),
        cost: String(item?.cost ?? ""),
        status: String(item?.status ?? "completed"),
        timestamp: item?.timestamp ?? item?.created_at ?? null,
        dialingCode,
    };
}


function normalizeHistory(payload) {
    return asArray(payload)
        .map(normalizeOrder)
        .filter((item) => (
            item.orderId
            && item.phone
            && item.code
            && /facebook|meta viewpoints/i.test(item.service)
        ))
        .slice(0, maxHistoryItems);
}


function publicJob(job) {
    if (!job) return null;
    return {
        sessionId: job.sessionId,
        status: job.status,
        stage: job.stage,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        waitSeconds: job.waitSeconds,
        country: job.country ? { ...job.country } : null,
        secondsLeft: job.deadlineAt
            ? Math.max(0, Math.ceil((job.deadlineAt - Date.now()) / 1000))
            : 0,
        order: job.order ? { ...job.order } : null,
        message: job.message,
        error: job.error,
    };
}


function purchaseError(result) {
    const type = String(result?.type ?? "").trim();
    if (type === "OUT_OF_STOCK") return "Для вибраної країни зараз немає номерів";
    if (type === "BALANCE_ERROR") return "Недостатньо коштів на балансі SMSPool";
    if (type === "PRICE_NOT_FOUND") return "SMSPool не знайшов доступної ціни";
    return String(result?.message ?? type ?? "SMSPool не створив замовлення");
}


export default class SmsPoolPhoneVerificationManager {
    constructor({
        smsPool,
        personalAccountSessionManager,
        pollingIntervalMs = defaultPollingIntervalMs,
        wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
        logger = null,
        countryCatalog = null,
    }) {
        this.smsPool = smsPool;
        this.personalAccountSessionManager = personalAccountSessionManager;
        this.pollingIntervalMs = pollingIntervalMs;
        this.wait = wait;
        this.logger = logger;
        this.countryCatalog = countryCatalog;
        this.jobs = new Map();
        this.countries = [];
        this.history = [];
        this.balance = null;
        this.cancelledOrderIds = new Set();
    }


    async getDashboard(sessionId = null) {
        const [balanceResult, countriesResult, historyResult] = await Promise.allSettled([
            this.smsPool.getBalance(),
            this.countries.length ? Promise.resolve(this.countries) : this.smsPool.listCountries(),
            this.smsPool.getSmsOrderHistory({ limit: maxHistoryItems }),
        ]);
        if (balanceResult.status === "fulfilled") {
            this.balance = normalizeBalance(balanceResult.value);
        }
        if (countriesResult.status === "fulfilled") {
            const catalog = this.countryCatalog ? await this.countryCatalog.list() : [];
            this.countries = Array.isArray(countriesResult.value)
                && countriesResult.value.every((item) => item?.iso)
                ? countriesResult.value
                : normalizeCountries(countriesResult.value, catalog);
        }
        if (historyResult.status === "fulfilled") {
            const remoteHistory = normalizeHistory(historyResult.value);
            const merged = [...this.history, ...remoteHistory];
            this.history = merged.filter((item, index) => (
                merged.findIndex((candidate) => candidate.orderId === item.orderId) === index
            )).slice(0, maxHistoryItems);
        }

        const firstFailure = [balanceResult, countriesResult].find(
            (result) => result.status === "rejected"
        );
        return {
            service: facebookSmsPoolService,
            balance: this.balance,
            countries: this.countries,
            history: this.history,
            job: publicJob(this.jobs.get(String(sessionId))),
            warning: firstFailure?.reason?.message ?? null,
        };
    }


    getState(sessionId) {
        return {
            balance: this.balance,
            history: this.history,
            job: publicJob(this.jobs.get(String(sessionId))),
        };
    }


    start(sessionId, input) {
        const key = String(sessionId ?? "");
        const existing = this.jobs.get(key);
        if (existing && ["running", "stopping"].includes(existing.status)) {
            throw managerError("SMS-підтвердження вже виконується", "SMS_POOL_JOB_ACTIVE");
        }
        const country = this.countries.find((item) => String(item.id) === String(input.countryId));
        if (!country) throw managerError("Оберіть країну SMS-номера", "SMS_POOL_COUNTRY_REQUIRED");
        if (!input.adAccountId) {
            throw managerError("Оберіть рекламний кабінет", "SMS_POOL_AD_ACCOUNT_REQUIRED");
        }
        const maxAttempts = Math.min(20, Math.max(1, Number(input.maxAttempts) || 5));
        const waitSeconds = Math.min(300, Math.max(15, Number(input.waitSeconds) || 60));
        const job = {
            sessionId: key,
            status: "running",
            stage: "ordering",
            attempt: 0,
            maxAttempts,
            waitSeconds,
            country,
            adAccountId: String(input.adAccountId),
            order: null,
            deadlineAt: null,
            message: "Готуємо першу спробу",
            error: null,
            stopRequested: false,
            resendOrder: null,
        };
        this.jobs.set(key, job);
        void this.#run(job);
        return publicJob(job);
    }


    resend(sessionId, input) {
        const key = String(sessionId ?? "");
        const existing = this.jobs.get(key);
        if (existing && ["running", "stopping"].includes(existing.status)) {
            throw managerError("Спочатку зупиніть активне замовлення", "SMS_POOL_JOB_ACTIVE");
        }
        const source = this.history.find((item) => item.orderId === String(input.orderId));
        if (!source) throw managerError("Замовлення для повторної SMS не знайдено", "SMS_POOL_ORDER_NOT_FOUND");
        if (!input.adAccountId) {
            throw managerError("Оберіть рекламний кабінет", "SMS_POOL_AD_ACCOUNT_REQUIRED");
        }
        const country = this.countries.find((item) => item.iso === source.country)
            ?? {
                id: source.country,
                iso: source.country,
                name: source.country,
                dialingCode: source.dialingCode || countryCallingCodes[source.country] || "",
            };
        if (!country.dialingCode && source.dialingCode) country.dialingCode = source.dialingCode;
        const waitSeconds = Math.min(300, Math.max(15, Number(input.waitSeconds) || 60));
        const job = {
            sessionId: key,
            status: "running",
            stage: "resending",
            attempt: 1,
            maxAttempts: 1,
            waitSeconds,
            country,
            adAccountId: String(input.adAccountId),
            order: { ...source, code: "", fullSms: "", status: "resending" },
            deadlineAt: null,
            message: "Запитуємо повторне SMS",
            error: null,
            stopRequested: false,
            resendOrder: source,
        };
        this.jobs.set(key, job);
        void this.#run(job);
        return publicJob(job);
    }


    async stop(sessionId) {
        const job = this.jobs.get(String(sessionId));
        if (!job || !["running", "stopping"].includes(job.status)) return publicJob(job);
        job.stopRequested = true;
        job.status = "stopping";
        job.stage = "cancelling";
        job.message = "Зупиняємо та повертаємо кошти";
        if (job.order?.orderId) await this.#cancel(job.order.orderId);
        return publicJob(job);
    }


    async stopAll() {
        await Promise.all([...this.jobs.keys()].map((sessionId) => this.stop(sessionId)));
    }


    async #run(job) {
        try {
            if (job.resendOrder) {
                const result = await this.smsPool.resendSms(job.resendOrder.orderId);
                if (Number(result?.success ?? 1) !== 1) throw managerError(
                    result?.message || "SMSPool не дозволив повторне SMS",
                    "SMS_POOL_RESEND_FAILED"
                );
                await this.#requestFacebookCode(job);
                await this.#poll(job, true);
            } else {
                for (let attempt = 1; attempt <= job.maxAttempts && !job.stopRequested; attempt += 1) {
                    job.attempt = attempt;
                    job.stage = "ordering";
                    job.message = `Купуємо номер · спроба ${attempt} з ${job.maxAttempts}`;
                    const purchase = await this.smsPool.purchaseSms({
                        country: job.country.id,
                        service: facebookSmsPoolService,
                        pricingOption: 0,
                        quantity: 1,
                        activationType: "SMS",
                    });
                    if (Number(purchase?.success) !== 1) {
                        throw managerError(purchaseError(purchase), purchase?.type || "SMS_POOL_PURCHASE_FAILED");
                    }
                    job.order = normalizeOrder({ ...purchase, status: "pending" });
                    job.country.dialingCode = String(purchase?.cc ?? "").replace(/\D/g, "");
                    await this.#requestFacebookCode(job);
                    const completed = await this.#poll(job, false);
                    if (completed || job.stopRequested) break;
                }
            }

            if (job.stopRequested) {
                job.status = "stopped";
                job.stage = "stopped";
                job.message = "Автоматичне підтвердження зупинено";
            } else if (job.status === "running") {
                job.status = "failed";
                job.stage = "failed";
                job.message = "Код не надійшов за відведені спроби";
            }
        } catch (error) {
            job.status = job.stopRequested ? "stopped" : "failed";
            job.stage = job.status;
            job.error = String(error?.message ?? error);
            job.message = job.error;
            this.logger?.error("sms-pool.phone-verification.failed", "SMS-підтвердження завершилося помилкою", {
                sessionId: job.sessionId,
                orderId: job.order?.orderId ?? null,
                error,
            });
            if (job.order?.orderId && !job.order.code) await this.#cancel(job.order.orderId);
        } finally {
            job.deadlineAt = null;
            await this.#refreshBalance();
        }
    }


    async #requestFacebookCode(job) {
        if (job.stopRequested) return;
        job.stage = "facebook-request";
        job.message = "Номер підставлено · Facebook надсилає SMS";
        await this.personalAccountSessionManager.requestPhoneCode(job.sessionId, {
            adAccountId: job.adAccountId,
            phoneE164: job.order.phone,
            countryCode: job.country.iso,
            locale: "en_US",
            method: "SMS",
        });
    }


    async #poll(job, resend) {
        job.stage = "waiting-code";
        job.deadlineAt = Date.now() + job.waitSeconds * 1000;
        job.message = "Очікуємо код від SMSPool";

        while (!job.stopRequested && Date.now() < job.deadlineAt) {
            await this.wait(Math.min(this.pollingIntervalMs, Math.max(0, job.deadlineAt - Date.now())));
            if (job.stopRequested) break;
            const checked = resend
                ? await this.smsPool.checkSmsResend(job.order.orderId)
                : await this.smsPool.checkSms(job.order.orderId);
            const status = Number(checked?.status);
            const code = String(checked?.sms ?? checked?.code ?? "").trim();
            if (status === smsPoolOrderStatuses.COMPLETED && code) {
                job.order = normalizeOrder({
                    ...job.order,
                    ...checked,
                    order_id: job.order.orderId,
                    number: job.order.phone,
                    short_name: job.country.iso,
                    status: "completed",
                });
                job.stage = "submitting-code";
                job.message = "Код отримано · підтверджуємо у Facebook";
                await this.personalAccountSessionManager.submitPhoneCode(job.sessionId, { code });
                job.status = "completed";
                job.stage = "completed";
                job.message = "Номер телефону підтверджено";
                this.#remember(job.order);
                return true;
            }
            if ([
                smsPoolOrderStatuses.EXPIRED,
                smsPoolOrderStatuses.CANCELLED,
                smsPoolOrderStatuses.REFUNDED,
            ].includes(status)) break;
        }

        if (job.order?.orderId && !job.order.code) {
            job.stage = "refunding";
            job.message = "Час вийшов · повертаємо кошти";
            await this.#cancel(job.order.orderId);
        }
        job.deadlineAt = null;
        job.order = null;
        return false;
    }


    async #cancel(orderId) {
        if (this.cancelledOrderIds.has(orderId)) return true;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                const result = await this.smsPool.cancelSms(orderId);
                if (Number(result?.success ?? 1) === 1) {
                    this.cancelledOrderIds.add(orderId);
                    return true;
                }
                const retryable = /cannot be cancelled yet/i.test(String(result?.message ?? ""));
                if (!retryable || attempt === 3) return false;
            } catch (error) {
                if (attempt === 3) {
                    this.logger?.warn("sms-pool.refund.failed", "Не вдалося скасувати SMSPool-замовлення", {
                        orderId,
                        error,
                    });
                    return false;
                }
            }
            await this.wait(this.pollingIntervalMs);
        }
        return false;
    }


    #remember(order) {
        this.history = [order, ...this.history.filter((item) => item.orderId !== order.orderId)]
            .slice(0, maxHistoryItems);
    }


    async #refreshBalance() {
        try {
            this.balance = normalizeBalance(await this.smsPool.getBalance());
        } catch {}
    }
}


export {
    facebookSmsPoolService,
    normalizeBalance,
    normalizeCountries,
    normalizeHistory,
};
