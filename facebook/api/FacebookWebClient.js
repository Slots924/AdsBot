import { Cookie, CookieJar } from "tough-cookie";
import ProxyHttpClient from "../../services/proxy/ProxyHttpClient.js";
import parseWebSession from "../session/parseWebSession.js";
import { actionError } from "../autoupload/graphql/errors.js";

const homeUrl = "https://www.facebook.com/";
const isFacebook = (host) => host === "facebook.com" || host.endsWith(".facebook.com");
const failure = (message, status = "error") => Object.assign(new Error(message), { sessionStatus: status });

export default class FacebookWebClient {
    #jar = new CookieJar();
    #http;
    #userAgent;
    #expectedId;
    #session = null;
    #sessionCheckedAt = 0;
    #queue = Promise.resolve();

    constructor({ cookies, userAgent, proxy, httpClient }) {
        if (!String(userAgent ?? "").trim()) throw failure("Відсутній User-Agent профілю");
        this.#userAgent = userAgent;
        this.#http = httpClient ?? new ProxyHttpClient({ proxies: [proxy] });
        for (const item of cookies ?? []) {
            const domain = String(item.domain ?? "").replace(/^\./, "").toLowerCase();
            if (!isFacebook(domain)) continue;
            const expires = Number(item.expirationDate ?? item.expires);
            const cookie = new Cookie({
                key: item.name, value: item.value, domain, path: item.path || "/",
                hostOnly: item.hostOnly ?? !String(item.domain).startsWith("."),
                secure: Boolean(item.secure), httpOnly: Boolean(item.httpOnly),
                ...(!item.session && expires > 0 ? { expires: new Date(expires * 1000) } : {}),
                ...(["strict", "lax", "none"].includes(item.sameSite) ? { sameSite: item.sameSite } : {}),
            });
            this.#jar.setCookieSync(cookie, `https://${domain}${cookie.path}`, { ignoreError: true });
        }
        const initial = this.#jar.getCookiesSync(homeUrl);
        this.#expectedId = initial.find((cookie) => cookie.key === "c_user")?.value;
        if (!/^\d+$/.test(this.#expectedId ?? "") || !initial.some((cookie) => cookie.key === "xs" && cookie.value)) {
            throw failure("У збережених cookies немає чинних c_user та xs. Потрібна авторизація у профілі", "login_required");
        }
    }

    // Серіалізує дії одного клієнта, щоб вони не змінювали сесію одночасно.
    run(action) {
        const operation = this.#queue.then(action);
        this.#queue = operation.catch(() => {});
        return operation;
    }

    getFbData(profileId) {
        if (!this.#session) throw actionError("Спочатку перевірте сесію Facebook", "FACEBOOK_SESSION_REQUIRED");
        return Object.freeze({ profileId, userId: this.#expectedId, session: this.#session, client: this });
    }

    validateFbData(fbData) {
        if (fbData?.client !== this || fbData.session !== this.#session || String(fbData.userId) !== this.#expectedId) {
            throw actionError("Сесія була оновлена або належить іншому профілю", "FACEBOOK_SESSION_MISMATCH", { actionRequired: "refresh_session" });
        }
        if (Date.now() - this.#sessionCheckedAt > 15 * 60_000) throw actionError("Підготуйте актуальну сесію Facebook", "FACEBOOK_SESSION_EXPIRED", { actionRequired: "refresh_session" });
    }

    async request({ url = homeUrl, method = "get", data, signal, headers = {}, mutation = !["get", "head"].includes(String(method).toLowerCase()), allowHttpErrors = false }) {
        signal?.throwIfAborted();
        let target = new URL(url, homeUrl);
        let requestMethod = method;
        let requestData = data;
        for (let redirects = 0; redirects <= 5; redirects += 1) {
            if (target.protocol !== "https:" || !isFacebook(target.hostname) || target.username || target.password || (target.port && target.port !== "443")) {
                throw failure("Facebook повернув непідтримуваний напрямок переходу");
            }
            let response;
            const navigation = ["get", "head"].includes(String(requestMethod).toLowerCase());
            try { response = await this.#http.request({
                method: requestMethod, url: target.href, data: requestData, signal,
                timeout: 30000, maxRedirects: 0, responseType: "text", maxContentLength: 15 * 1024 * 1024,
                validateStatus: () => true,
                headers: {
                    ...headers,
                    "User-Agent": this.#userAgent,
                    Cookie: this.#jar.getCookieStringSync(target.href),
                    // Заголовки навігації потрібні для отримання HTML домашньої сторінки Facebook.
                    Accept: navigation ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" : "*/*",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Sec-Fetch-Dest": navigation ? "document" : "empty",
                    "Sec-Fetch-Mode": navigation ? "navigate" : "cors",
                    "Sec-Fetch-Site": navigation ? "none" : "same-origin",
                    ...(navigation ? { "Sec-Fetch-User": "?1", "Upgrade-Insecure-Requests": "1" } : { Origin: "https://www.facebook.com", Referer: homeUrl }),
                },
            }, { retryOnConnectionError: !mutation }); }
            catch (error) {
                if (!mutation) throw error;
                throw actionError("Відповідь на заявку не отримано. Результат невідомий; перевірте стан перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", {
                    httpStatus: error?.response?.status ?? null, outcomeUnknown: true, actionRequired: "check_friendship_status",
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
                catch (error) { if (mutation) error.outcomeUnknown = true; throw error; }
                if (mutation) throw actionError("Facebook перенаправив запит. Результат заявки невідомий; повтор не виконувався", "FACEBOOK_WRITE_REDIRECT", {
                    httpStatus: response.status, outcomeUnknown: true, actionRequired: "check_friendship_status",
                });
                if (response.status === 303 || ([301, 302].includes(response.status) && requestMethod.toLowerCase() === "post")) {
                    requestMethod = "get";
                    requestData = undefined;
                }
                continue;
            }
            if (!allowHttpErrors && (response.status < 200 || response.status >= 300)) throw Object.assign(failure(`Facebook повернув HTTP ${response.status}`), { httpStatus: response.status });
            try { this.#checkPage(target, String(response.data)); }
            catch (error) { if (mutation) error.outcomeUnknown = true; throw error; }
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

    checkSession({ signal } = {}) {
        return this.run(async () => {
            this.#session = null;
            let response;
            try { response = await this.request({ signal }); }
            catch (error) {
                if (signal?.aborted) throw signal.reason ?? error;
                if (error.sessionStatus) throw error;
                throw failure("Не вдалося виконати запит через проксі профілю: перевірте з’єднання");
            }
            const { session, missing } = parseWebSession(response.data);
            if (missing.length) throw failure(`Не отримано поля сесії: ${missing.join(", ")}`);
            if (session.FacebookID !== this.#expectedId) throw failure("Facebook повернув інший акаунт; перевірте активний профіль");
            const currentCookies = this.#jar.getCookiesSync(homeUrl);
            const currentId = currentCookies.find((cookie) => cookie.key === "c_user")?.value;
            if (currentId !== this.#expectedId) throw failure("Cookies відповіді належать іншому акаунту");
            if (!currentCookies.some((cookie) => cookie.key === "xs" && cookie.value)) throw failure("Facebook скинув сесію. Потрібна повторна авторизація", "login_required");
            this.#session = Object.freeze(session);
            this.#sessionCheckedAt = Date.now();
            return { fields: Object.keys(session).filter((key) => session[key]), message: "Facebook відповів. Дані сесії отримано, акаунт підтверджено" };
        });
    }
}
