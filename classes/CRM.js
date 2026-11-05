import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { CookieJar } from "tough-cookie";

const crmOrigin = "https://crm.we-can.xyz";
export const defaultCrmUserAgent = "AntQueenBrowser/1337.42 (Ubuntu 24.04 LTS; Linux x86_64; ColonyMode)";
const fields = ["login", "password", "session", "token", "cookies", "userAgent"];
const defaults = { login: "", password: "", session: "", token: "", cookies: "", userAgent: defaultCrmUserAgent };

function decodeHtml(value = "") {
    return value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos|#39);/gi, (match, number, name) => {
        if (number) return String.fromCodePoint(number[0].toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number));
        return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" })[name.toLowerCase()] ?? match;
    });
}

function attribute(tag, name) {
    const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return match ? decodeHtml(match[1]) : "";
}

function optionsFor(html, name) {
    const selects = [...html.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)];
    const selected = selects.find(match => attribute(match[0].slice(0, match[0].indexOf(">") + 1), "name") === name)?.[0] ?? "";
    return [...selected.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(match => ({
        id: attribute(match[1], "value"), name: decodeHtml(match[2].replace(/<[^>]*>/g, "").trim()),
    })).filter(option => option.id);
}

export default class CRM {
    #operation = Promise.resolve();

    constructor({ settingsFile, encrypt, decrypt }) {
        this.settingsFile = settingsFile;
        this.encrypt = encrypt;
        this.decrypt = decrypt;
    }

    getSettings() {
        return this.#enqueue(async () => {
            let stored;
            try {
                stored = JSON.parse(await readFile(this.settingsFile, "utf8"));
            } catch (error) {
                if (error.code === "ENOENT") return { ...defaults };
                throw error;
            }
            return Object.fromEntries(fields.map((key) =>
                [key, Object.hasOwn(stored, key) ? (stored[key] ? this.decrypt(stored[key]) : "") : defaults[key]]));
        });
    }

    saveSettings(input = {}) {
        return this.#enqueue(async () => {
            const values = Object.fromEntries(fields.map((key) =>
                [key, String(input[key] ?? defaults[key])]));
            const encrypted = Object.fromEntries(Object.entries(values).map(([key, value]) =>
                [key, value ? this.encrypt(value) : ""]));
            await mkdir(path.dirname(this.settingsFile), { recursive: true });
            const temporaryFile = `${this.settingsFile}.tmp`;
            await writeFile(temporaryFile, JSON.stringify(encrypted), { mode: 0o600 });
            await rename(temporaryFile, this.settingsFile);
            return values;
        });
    }

    async login(login, password) {
        if (!login || !password) throw new Error("Для входу в CRM потрібні логін і пароль");
        const userAgent = this.settingsFile ? (await this.getSettings()).userAgent || defaultCrmUserAgent : defaultCrmUserAgent;
        const jar = new CookieJar();
        const url = `${crmOrigin}/login/?next=/campaigns/`;
        const request = async (options) => {
            let response;
            try {
                response = await axios({ ...options, headers: { ...options.headers, "User-Agent": userAgent }, timeout: 30000, maxRedirects: 0, validateStatus: () => true });
            } catch {
                throw new Error("Не вдалося підключитися до CRM");
            }
            for (const cookie of response.headers["set-cookie"] ?? []) await jar.setCookie(cookie, url);
            return response;
        };
        const page = await request({ method: "get", url, responseType: "text" });
        if (page.status !== 200 || typeof page.data !== "string") throw new Error("Не вдалося отримати сторінку входу CRM");
        const input = page.data.match(/<input\b[^>]*name=["']csrfmiddlewaretoken["'][^>]*>/i)?.[0];
        const token = input?.match(/\bvalue=["']([^"']+)["']/i)?.[1];
        if (!token) throw new Error("На сторінці входу CRM не знайдено CSRF-токен");
        const body = new URLSearchParams({ csrfmiddlewaretoken: token, username: String(login), password: String(password), next: "/campaigns/" });
        const response = await request({ method: "post", url, data: body.toString(), headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Referer: url,
            Cookie: await jar.getCookieString(url),
        } });
        const cookies = await jar.getCookies(crmOrigin);
        let destination;
        try { destination = new URL(response.headers.location, crmOrigin); } catch { /* Відповідь без перенаправлення. */ }
        if (response.status !== 302 || destination?.origin !== crmOrigin || destination.pathname !== "/campaigns/" || !cookies.some(cookie => cookie.key === "sessionid")) {
            throw new Error("Не вдалося авторизуватися в CRM: перевірте логін і пароль");
        }
        return {
            session: JSON.stringify(await jar.serialize()),
            token: cookies.find(cookie => cookie.key === "sessionid").value,
            cookies: await jar.getCookieString(crmOrigin),
        };
    }

    async getAuthorization() {
        const settings = await this.getSettings();
        let session = settings.session;
        let cookies = settings.cookies;
        let token = settings.token;
        if (session) {
            try {
                const jar = await CookieJar.deserialize(JSON.parse(session));
                const entries = await jar.getCookies(crmOrigin);
                const sessionCookie = entries.find(cookie => cookie.key === "sessionid");
                if (sessionCookie) {
                    return { session, token: sessionCookie.value, cookies: await jar.getCookieString(crmOrigin), userAgent: settings.userAgent || defaultCrmUserAgent };
                }
            } catch { /* Некоректну або застарілу сесію потрібно отримати знову. */ }
        }
        if (cookies) {
            const jar = new CookieJar();
            try {
                for (const item of cookies.split(";")) if (item.trim()) await jar.setCookie(item.trim(), crmOrigin);
                const sessionCookie = (await jar.getCookies(crmOrigin)).find(cookie => cookie.key === "sessionid");
                if (sessionCookie) {
                    return { session: JSON.stringify(await jar.serialize()), token: sessionCookie.value, cookies: await jar.getCookieString(crmOrigin), userAgent: settings.userAgent || defaultCrmUserAgent };
                }
            } catch { /* Некоректні cookies не можна використати. */ }
        }
        if (token) {
            const jar = new CookieJar();
            try {
                await jar.setCookie(`sessionid=${token}; Secure; HttpOnly; Path=/`, crmOrigin);
                if ((await jar.getCookies(crmOrigin)).some(cookie => cookie.key === "sessionid")) {
                    return { session: JSON.stringify(await jar.serialize()), token, cookies: await jar.getCookieString(crmOrigin), userAgent: settings.userAgent || defaultCrmUserAgent };
                }
            } catch { /* Некоректний токен не можна використати. */ }
        }
        const authorization = await this.login(settings.login, settings.password);
        const current = await this.getSettings();
        await this.saveSettings({ ...current, ...authorization });
        return { ...authorization, userAgent: current.userAgent || defaultCrmUserAgent };
    }

    async #request(method, endpoint, options = {}) {
        const auth = await this.getAuthorization();
        let response;
        try {
            response = await axios({ method, url: `${crmOrigin}${endpoint}`, data: options.data, params: options.params,
                headers: { "User-Agent": auth.userAgent, Cookie: auth.cookies, ...options.headers },
                timeout: 30000, maxRedirects: 0, validateStatus: () => true });
        } catch {
            throw new Error(method === "post" ? "CRM не відповіла на запит. Перевірте список кампаній перед повтором: кампанію могло бути створено." : "Не вдалося підключитися до CRM");
        }
        if ([301, 302, 303, 307, 308].includes(response.status) && String(response.headers.location ?? "").includes("/login/")) {
            throw new Error("Сесія CRM завершилася. Очистіть сесію, токен і cookies у налаштуваннях для повторного входу.");
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`CRM повернула помилку HTTP ${response.status}`);
        return response.data;
    }

    async getCampaigns() {
        const html = await this.#request("get", "/campaigns/");
        if (typeof html !== "string" || !html.includes('camp-row')) {
            if (typeof html === "string" && /Кампанії\s*0/.test(html)) return [];
            throw new Error("Не вдалося прочитати список кампаній CRM");
        }
        return [...html.matchAll(/<tr\b([^>]*\bclass=["'][^"']*\bcamp-row\b[^"']*["'][^>]*)>([\s\S]*?)<\/tr>/gi)].map(([, attrs, row]) => {
            const name = row.match(/<span\b[^>]*class=["'][^"']*\bcamp-name\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "";
            const linkButton = row.match(/<button\b[^>]*aria-label=["']Коротке посилання["'][^>]*>/i)?.[0] ?? "";
            return { id: attribute(attrs, "data-pk"), name: decodeHtml(name.replace(/<[^>]*>/g, "").trim()), url: attribute(linkButton, "data-copy") };
        }).filter(item => item.id && item.name);
    }

    async getCampaignForm() {
        const html = await this.#request("get", "/campaigns/");
        if (typeof html !== "string") throw new Error("Не вдалося отримати форму CRM");
        const geos = optionsFor(html, "geo");
        const domains = optionsFor(html, "domain");
        if (!geos.length || !domains.length) throw new Error("Не вдалося прочитати параметри форми CRM");
        const sources = [...html.matchAll(/<button\b[^>]*class=["'][^"']*\bsource-chip\b[^"']*["'][^>]*>[\s\S]*?<\/button>/gi)].map(match => ({
            id: attribute(match[0], "data-value"), name: match[0].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/✓/g, "").trim(),
            needsToken: attribute(match[0], "data-needs-token") === "1",
        })).filter(item => item.id);
        return { geos, domains, sources };
    }

    async getCampaignGeoOptions(geo) {
        if (!/^[A-Z]{2}$/.test(String(geo))) throw new Error("Некоректне GEO CRM");
        const data = await this.#request("get", "/campaigns/presets/", { params: { geo }, headers: { "X-Requested-With": "fetch" } });
        if (!data || !Array.isArray(data.presets) || !Array.isArray(data.prelanders)) throw new Error("Не вдалося завантажити потоки CRM");
        return data;
    }

    async createCampaign(input = {}) {
        const { source, geo, domain, creative, pixel, token = "", prelander = "0", preset = "", fallback_preset = "", filters_on = false, rules = [] } = input;
        if (!source || !geo || !domain || !creative || !pixel || (String(source) === "3" && !token)) throw new Error("Заповніть обов'язкові поля кампанії CRM");
        if (filters_on ? !fallback_preset || !rules.length || rules.some(rule => !rule.platform || !rule.preset) : !preset) throw new Error("Оберіть потік кампанії CRM");
        const html = await this.#request("get", "/campaigns/");
        const form = typeof html === "string" ? html.match(/<form\b[^>]*action=["']\/campaigns\/new\/["'][^>]*>[\s\S]*?<\/form>/i)?.[0] : null;
        const csrfInput = form?.match(/<input\b[^>]*name=["']csrfmiddlewaretoken["'][^>]*>/i)?.[0];
        const csrf = csrfInput ? attribute(csrfInput, "value") : "";
        if (!csrf) throw new Error("Не вдалося отримати CSRF-токен форми CRM");
        const body = new FormData();
        for (const [key, value] of Object.entries({ csrfmiddlewaretoken: csrf, edit_id: "", source, geo, domain, creative, prelander, pixel, token, preset, fallback_preset })) body.append(key, String(value));
        if (filters_on) {
            body.append("filters_on", "on");
            for (const rule of rules) { body.append("rule_platform", String(rule.platform)); body.append("rule_preset", String(rule.preset)); }
        }
        const result = await this.#request("post", "/campaigns/new/", { data: body, headers: { Referer: `${crmOrigin}/campaigns/`, "X-Requested-With": "fetch" } });
        if (!result?.ok) throw new Error(Array.isArray(result?.errors) ? result.errors.join("; ") : "CRM не підтвердила створення кампанії");
        return { ok: true };
    }

    #enqueue(operation) {
        const result = this.#operation.then(operation);
        this.#operation = result.catch(() => {});
        return result;
    }
}
