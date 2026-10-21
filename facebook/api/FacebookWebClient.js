import { Cookie, CookieJar } from "tough-cookie";
import ProxyHttpClient from "../../services/proxy/ProxyHttpClient.js";
import parseWebSession from "../session/parseWebSession.js";

const homeUrl = "https://www.facebook.com/";
const isFacebook = (host) => host === "facebook.com" || host.endsWith(".facebook.com");
const failure = (message, status = "error") => Object.assign(new Error(message), { sessionStatus: status });

export default class FacebookWebClient {
    #jar = new CookieJar();
    #http;
    #userAgent;
    #expectedId;
    #session = null;
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

    async request({ url = homeUrl, method = "get", data, signal }) {
        let target = new URL(url, homeUrl);
        let requestMethod = method;
        let requestData = data;
        for (let redirects = 0; redirects <= 5; redirects += 1) {
            if (target.protocol !== "https:" || !isFacebook(target.hostname) || target.username || target.password || (target.port && target.port !== "443")) {
                throw failure("Facebook повернув непідтримуваний напрямок переходу");
            }
            const response = await this.#http.request({
                method: requestMethod, url: target.href, data: requestData, signal,
                timeout: 30000, maxRedirects: 0, responseType: "text", maxContentLength: 15 * 1024 * 1024,
                validateStatus: () => true,
                headers: {
                    "User-Agent": this.#userAgent,
                    Cookie: this.#jar.getCookieStringSync(target.href),
                    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                },
            });
            const updates = response.headers?.["set-cookie"] ?? [];
            for (const cookie of typeof updates === "string" ? [updates] : updates) {
                this.#jar.setCookieSync(cookie, target.href, { ignoreError: true });
            }
            if ([301, 302, 303, 307, 308].includes(response.status) && response.headers?.location) {
                target = new URL(response.headers.location, target);
                if (target.protocol !== "https:" || !isFacebook(target.hostname)) throw failure("Непідтримуваний перехід Facebook");
                this.#checkPage(target, "");
                if (response.status === 303 || ([301, 302].includes(response.status) && requestMethod.toLowerCase() === "post")) {
                    requestMethod = "get";
                    requestData = undefined;
                }
                continue;
            }
            if (response.status < 200 || response.status >= 300) throw failure(`Facebook повернув HTTP ${response.status}`);
            this.#checkPage(target, String(response.data));
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
            this.#session = session;
            return { fields: Object.keys(session).filter((key) => session[key]), message: "Facebook відповів. Дані сесії отримано, акаунт підтверджено" };
        });
    }
}
