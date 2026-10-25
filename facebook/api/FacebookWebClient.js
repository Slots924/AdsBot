import createFacebookCookieJar from "../session/createFacebookCookieJar.js";
import { CookieJar } from "tough-cookie";
import FacebookGraphApi from "./FacebookGraphApi.js";
import ProxyHttpClient from "../../services/proxy/ProxyHttpClient.js";
import parseWebSession from "../session/parseWebSession.js";
import getFacebookAccountId from "../session/getFacebookAccountId.js";
import { actionError } from "../autoupload/graphql/errors.js";
import describeHttpError from "../../services/logging/httpDiagnostics.js";
import { getLogger } from "../../services/logging/runtimeLogger.js";

const homeUrl = "https://www.facebook.com/";
const isFacebook = (host) => host === "facebook.com" || host.endsWith(".facebook.com");
const failure = (message, status = "error") => Object.assign(new Error(message), { sessionStatus: status });

export default class FacebookWebClient {
    #jar;
    #http;
    #userAgent;
    #expectedId;
    #session = null;
    #sessionCheckedAt = 0;
    #adsManager = null;
    #proxy;
    #onSessionStatus;
    #queue = Promise.resolve();

    constructor({ cookies, userAgent, proxy, httpClient, cookieJar, onSessionStatus }) {
        if (!String(userAgent ?? "").trim()) throw failure("Відсутній User-Agent профілю");
        this.#userAgent = userAgent;
        this.#proxy = proxy ? { ...proxy } : null;
        this.#onSessionStatus = onSessionStatus;
        this.#http = httpClient ?? new ProxyHttpClient({ proxies: [proxy] });
        this.#jar = cookieJar ? CookieJar.deserializeSync(cookieJar) : createFacebookCookieJar(cookies);
        const initial = this.#jar.getCookiesSync(homeUrl);
        this.#expectedId = getFacebookAccountId(initial);
        if (!/^\d+$/.test(this.#expectedId ?? "") || !initial.some((cookie) => cookie.key === "xs" && cookie.value)) {
            throw failure("У збережених cookies немає чинних c_user та xs. Потрібна авторизація у профілі", "login_required");
        }
    }

    static restore(snapshot, options = {}) {
        const client = new FacebookWebClient({ ...snapshot, ...options });
        const savedAccountId = snapshot.session?.accountId ?? snapshot.session?.FacebookID;
        if (!snapshot.session || String(savedAccountId) !== client.#expectedId
            || !/^[1-9]\d*$/.test(String(snapshot.session.FacebookID ?? "")) || !Number.isFinite(Date.parse(snapshot.checkedAt))) {
            throw actionError("Збережена сесія не відповідає профілю. Запустіть нову перевірку", "FACEBOOK_SESSION_MISMATCH");
        }
        client.#session = Object.freeze({ ...snapshot.session });
        client.#sessionCheckedAt = Date.parse(snapshot.checkedAt);
        client.#adsManager = snapshot.adsManager ?? null;
        return client;
    }

    // Секретний знімок доступний лише backend-сховищу, не IPC або журналам.
    exportSession() {
        return { version: 1, userAgent: this.#userAgent, proxy: this.#proxy, cookieJar: this.#jar.serializeSync(),
            session: this.#session, checkedAt: new Date(this.#sessionCheckedAt).toISOString(), adsManager: this.#adsManager };
    }

    setAdsManagerSession(value) { this.#adsManager = value; }

    getAdsManagerData(fbData) {
        this.validateFbData(fbData);
        if (!this.#adsManager?.session || String(this.#adsManager.session.FacebookID) !== this.#expectedId) {
            throw actionError("Спочатку перевірте сесію Ads Manager", "ADS_MANAGER_SESSION_REQUIRED", { actionRequired: "refresh_session" });
        }
        return { session: this.#adsManager.session };
    }

    requestAdsManagerGraph(fbData, config) {
        this.getAdsManagerData(fbData);
        if (new URL(config.url).origin !== "https://adsmanager-graph.facebook.com") throw actionError("Непідтримуваний напрямок Ads Manager API", "ADS_MANAGER_GRAPH_ORIGIN_INVALID");
        if (!this.#adsManager.accessToken) throw actionError("Потрібен чинний access token Ads Manager", "ADS_MANAGER_ACCESS_TOKEN_REQUIRED", { actionRequired: "refresh_session" });
        // Контекст застосунку передається в Authorization, а не в URL або тілі mutation.
        return this.request({ ...config, headers: { ...config.headers, Authorization: `Bearer ${this.#adsManager.accessToken}` } });
    }

    createGraphApi() {
        if (!this.#adsManager?.accessToken) throw actionError("Потрібна нова перевірка Ads Manager", "ADS_MANAGER_SESSION_REQUIRED");
        return new FacebookGraphApi({ accountKey: `autoupload-${this.#expectedId}`, facebookUserId: this.#expectedId,
            accessToken: this.#adsManager.accessToken, userAgent: this.#userAgent,
            cookie: this.#jar.getCookieStringSync("https://graph.facebook.com/"), proxyHttpClient: this.#http });
    }

    async #handleSessionStatus(error) {
        if (!["login_required", "checkpoint"].includes(error?.sessionStatus)) return;
        this.#session = null;
        this.#adsManager = null;
        await this.#onSessionStatus?.({ status: error.sessionStatus, message: error.message });
    }

    // JSON-відповіді API також можуть повідомляти про втрату авторизації.
    async invalidateSession(error) { await this.#handleSessionStatus(error); }

    // Серіалізує дії одного клієнта, щоб вони не змінювали сесію одночасно.
    run(action) {
        const operation = this.#queue.then(action);
        this.#queue = operation.catch(() => {});
        return operation;
    }

    getFbData(profileId) {
        if (!this.#session) throw actionError("Спочатку перевірте сесію Facebook", "FACEBOOK_SESSION_REQUIRED");
        return Object.freeze({ profileId, userId: this.#expectedId, accountId: this.#expectedId,
            actorId: this.#session.FacebookID, session: this.#session, client: this });
    }

    validateFbData(fbData, { allowPageActor = false } = {}) {
        if (fbData?.client !== this || fbData.session !== this.#session || String(fbData.userId) !== this.#expectedId) {
            throw actionError("Сесія була оновлена або належить іншому профілю", "FACEBOOK_SESSION_MISMATCH", { actionRequired: "refresh_session" });
        }
        if (Date.now() - this.#sessionCheckedAt > 15 * 60_000) throw actionError("Підготуйте актуальну сесію Facebook", "FACEBOOK_SESSION_EXPIRED", { actionRequired: "refresh_session" });
        if (!allowPageActor && String(this.#session.FacebookID) !== this.#expectedId) {
            throw actionError("Ця дія потребує контексту соца; у сесії активна фанка", "FACEBOOK_SOCIAL_CONTEXT_REQUIRED");
        }
    }

    async request({ url = homeUrl, method = "get", data, signal, headers = {}, mutation = !["get", "head"].includes(String(method).toLowerCase()), allowHttpErrors = false, asFetch = false }) {
        signal?.throwIfAborted();
        let target = new URL(url, homeUrl);
        let requestMethod = method;
        let requestData = data;
        for (let redirects = 0; redirects <= 5; redirects += 1) {
            if (target.protocol !== "https:" || !isFacebook(target.hostname) || target.username || target.password || (target.port && target.port !== "443")) {
                throw failure("Facebook повернув непідтримуваний напрямок переходу");
            }
            let response;
            const navigation = !asFetch && ["get", "head"].includes(String(requestMethod).toLowerCase());
            try { response = await this.#http.request({
                method: requestMethod, url: target.href, data: requestData, signal,
                timeout: 30000, maxRedirects: 0, responseType: "text", maxContentLength: 15 * 1024 * 1024,
                validateStatus: () => true,
                headers: {
                    // Заголовки навігації потрібні для отримання HTML домашньої сторінки Facebook.
                    Accept: navigation ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" : "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Sec-Fetch-Dest": navigation ? "document" : "empty",
                    "Sec-Fetch-Mode": navigation ? "navigate" : "cors",
                    "Sec-Fetch-Site": navigation ? "none" : "same-origin",
                    ...(navigation ? { "Sec-Fetch-User": "?1", "Upgrade-Insecure-Requests": "1" } : { Origin: "https://www.facebook.com", Referer: homeUrl }),
                    ...headers,
                    "User-Agent": this.#userAgent,
                    Cookie: this.#jar.getCookieStringSync(target.href),
                },
            }, { retryOnConnectionError: !mutation }); }
            catch (error) {
                error.diagnostic = describeHttpError(error, { url: target.href, method: requestMethod, session: this.#session ?? {}, proxy: this.#proxy });
                getLogger("autoupload.http").error("autoupload.http.failed", error.diagnostic.message, error.diagnostic);
                if (!mutation) throw actionError(error.diagnostic.message, error.diagnostic.code, { diagnostic: error.diagnostic, httpStatus: error.diagnostic.httpStatus });
                throw actionError("Відповідь на заявку не отримано. Результат невідомий; перевірте стан перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", {
                    httpStatus: error?.response?.status ?? null, diagnostic: error.diagnostic, outcomeUnknown: true, actionRequired: "check_friendship_status",
                });
            }
            const updates = response.headers?.["set-cookie"] ?? [];
            for (const cookie of typeof updates === "string" ? [updates] : updates) {
                this.#jar.setCookieSync(cookie, target.href, { ignoreError: true });
            }
            if ([301, 302, 303, 307, 308].includes(response.status) && response.headers?.location) {
                target = new URL(response.headers.location, target);
                if (target.protocol !== "https:" || !isFacebook(target.hostname)) throw failure("Непідтримуваний перехід Facebook");
                try { this.#checkPage(target, ""); }
                catch (error) { await this.#handleSessionStatus(error); if (mutation) error.outcomeUnknown = true; throw error; }
                if (mutation) throw actionError("Facebook перенаправив запит. Результат заявки невідомий; повтор не виконувався", "FACEBOOK_WRITE_REDIRECT", {
                    httpStatus: response.status, outcomeUnknown: true, actionRequired: "check_friendship_status",
                });
                if (response.status === 303 || ([301, 302].includes(response.status) && requestMethod.toLowerCase() === "post")) {
                    requestMethod = "get";
                    requestData = undefined;
                }
                continue;
            }
            if (!allowHttpErrors && (response.status < 200 || response.status >= 300)) {
                const error = Object.assign(failure(`Facebook повернув HTTP ${response.status}`), { httpStatus: response.status });
                error.diagnostic = describeHttpError(Object.assign(error, { response }), { url: target.href, method: requestMethod, session: this.#session ?? {}, proxy: this.#proxy });
                getLogger("autoupload.http").error("autoupload.http.failed", error.diagnostic.message, error.diagnostic);
                throw error;
            }
            try { this.#checkPage(target, String(response.data)); }
            catch (error) { await this.#handleSessionStatus(error); if (mutation) error.outcomeUnknown = true; throw error; }
            return response;
        }
        throw failure("Забагато перенаправлень Facebook");
    }

    #checkPage(url, html) {
        if (/\/(checkpoint|two_step_verification|challenge)(\/|$)/i.test(url.pathname)) {
            throw failure("Facebook потребує підтвердження акаунта", "checkpoint");
        }
        if (/\/(login|recover)(\/|\.|$)/i.test(url.pathname) || /id=["']login_form["']/.test(html)) {
            throw failure("Facebook потребує повторної авторизації", "login_required");
        }
    }

    // Власник сесії та поточний actor можуть відрізнятися, коли вибрана фанка.
    #readSessionIdentity(response, { requireAccount = false } = {}) {
        const { session, missing } = parseWebSession(response.data);
        if (missing.length) throw failure(`Не отримано поля сесії: ${missing.join(", ")}`);
        const source = String(response.data).replace(/&quot;/g, '"');
        const accountId = source.match(/"ACCOUNT_ID"\s*:\s*"(\d+)"/)?.[1];
        const currentCookies = this.#jar.getCookiesSync(homeUrl);
        if (getFacebookAccountId(currentCookies) !== this.#expectedId) {
            throw failure("Cookies відповіді належать іншому акаунту");
        }
        if (!currentCookies.some(cookie => cookie.key === "xs" && cookie.value)) {
            throw failure("Facebook скинув сесію. Потрібна повторна авторизація", "login_required");
        }
        if ((accountId && accountId !== this.#expectedId)
            || ((requireAccount || session.FacebookID !== this.#expectedId) && accountId !== this.#expectedId)) {
            throw actionError("Контекст Facebook не відповідає власнику cookies", "FACEBOOK_SESSION_MISMATCH", { sessionStatus: "error" });
        }
        return { session, accountId: accountId ?? this.#expectedId };
    }

    // Читає контекст для запитів списку, не змінюючи перевірену сесію соціального профілю.
    async readActorContext({ signal } = {}) {
        const response = await this.request({ signal, mutation: false });
        const { session, accountId } = this.#readSessionIdentity(response, { requireAccount: true });
        if (!session.lsd) {
            throw actionError("Не вдалося прочитати актуальний контекст Facebook", "FACEBOOK_SESSION_FIELDS_MISSING");
        }
        return {
            accountId,
            actorId: session.FacebookID,
            runtime: {
                av: session.FacebookID, __user: session.FacebookID, __a: "1",
                fb_dtsg: session.fb_dtsg, lsd: session.lsd, jazoest: session.jazoest,
            },
        };
    }

    checkSession({ signal } = {}) {
        return this.run(async () => {
            this.#session = null;
            this.#adsManager = null;
            this.#sessionCheckedAt = 0;
            const response = await this.request({ signal });
            const { session, accountId } = this.#readSessionIdentity(response);
            // Зберігає фактичного actor і власника сесії без перемикання контексту.
            this.#session = Object.freeze({ ...session, accountId });
            this.#sessionCheckedAt = Date.now();
            return { accountId, actorId: session.FacebookID,
                fields: Object.keys(this.#session).filter((key) => this.#session[key]),
                message: "Facebook відповів. Дані сесії отримано, акаунт підтверджено" };
        });
    }
}
