import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import { defaultAfpUserAgent } from "../../facebook/api/accountCredentials.js";
import { normalizeFacebookCookie } from "../../facebook/accounts/FacebookAccountManager.js";

export function installationIdFor(accountKey) {
    if (/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(accountKey)) return accountKey;
    const hex = createHash("sha256").update(`AdsBot:${accountKey}`).digest("hex").slice(0, 32).split("");
    hex[12] = "8";
    hex[16] = "8";
    const id = hex.join("");
    return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export function cookieItems(value) {
    const items = normalizeFacebookCookie(value).split("; ").map((pair) => {
        const index = pair.indexOf("=");
        return { name: pair.slice(0, index), value: pair.slice(index + 1), domain: ".facebook.com", path: "/", secure: true };
    });
    if (!items.some((item) => item.name === "c_user") || !items.some((item) => item.name === "xs")) {
        throw new Error("Cookies мають містити c_user та xs");
    }
    if (items.length > 300 || items.some((item) => item.value.length > 20000 || !/^[\x21-\x3A\x3C-\x7E]*$/.test(item.value))) {
        throw new Error("Cookies не відповідають формату Spend Server");
    }
    return items;
}

export default class SpendServerService {
    #operation = Promise.resolve();
    #versions = new Map();

    constructor({ file, accountManager, request = (url, body, options) => axios.post(url, body, options) }) {
        this.file = file;
        this.accountManager = accountManager;
        this.request = request;
    }

    async load() {
        try { return JSON.parse(await readFile(this.file, "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        return { settings: { url: "", clientKey: "", userAgent: defaultAfpUserAgent, cookies: "" }, deliveries: {} };
    }

    mutate(callback) {
        const operation = this.#operation.then(async () => {
            const data = await this.load();
            const result = await callback(data);
            await mkdir(path.dirname(this.file), { recursive: true });
            await writeFile(`${this.file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
            await rename(`${this.file}.tmp`, this.file);
            return result;
        });
        this.#operation = operation.catch(() => {});
        return operation;
    }

    async getSettings() {
        return this.mutate(async (data) => {
            if (!data.settings.cookies && !data.seeded) {
                const accounts = await this.accountManager.list();
                const source = accounts.find((account) => /-0*53$/.test(account.accountKey));
                if (source?.hasCookie) {
                    const credentials = await this.accountManager.getEditorCredentials(source.accountKey);
                    cookieItems(credentials.cookie);
                    data.settings.cookies = credentials.cookie;
                    data.seeded = true;
                }
            }
            return data.settings;
        });
    }

    saveSettings(input) {
        return this.mutate((data) => {
            const settings = Object.fromEntries(["url", "clientKey", "userAgent", "cookies"].map((key) => [key, String(input?.[key] ?? "").trim()]));
            if (settings.url) {
                let url;
                try { url = new URL(settings.url); } catch { throw new Error("Некоректна адреса Spend Server"); }
                if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["/", "/fb_data/add"].includes(url.pathname)) throw new Error("Вкажіть HTTPS-адресу сервера або /fb_data/add без параметрів");
                settings.url = `${url.origin}/fb_data/add`;
            }
            if (!settings.userAgent || settings.userAgent.length > 20000 || /[^\x20-\xFF]/.test(settings.userAgent)) throw new Error("Некоректний User-Agent");
            if (/[^\x20-\x7E]/.test(settings.clientKey)) throw new Error("Некоректний Client Key");
            cookieItems(settings.cookies);
            if (JSON.stringify(settings) !== JSON.stringify(data.settings)) data.deliveries = {};
            data.settings = settings;
            data.seeded = true;
            return settings;
        });
    }

    fingerprint(token, settings) {
        return createHash("sha256").update(JSON.stringify([token, settings])).digest("hex");
    }

    async status(accountKey) {
        const data = await this.load();
        const credentials = await this.accountManager.getEditorCredentials(accountKey);
        const delivery = data.deliveries[accountKey];
        return delivery?.fingerprint === this.fingerprint(credentials.afpToken, data.settings)
            ? { state: delivery.state, sentAt: delivery.sentAt, message: delivery.message }
            : { state: "pending" };
    }

    invalidate(accountKey) {
        this.#versions.set(accountKey, (this.#versions.get(accountKey) || 0) + 1);
        return this.mutate((data) => { delete data.deliveries[accountKey]; });
    }

    async send(accountKey, checkedToken) {
        const version = (this.#versions.get(accountKey) || 0) + 1;
        this.#versions.set(accountKey, version);
        const settings = await this.getSettings();
        const { afpToken } = await this.accountManager.getEditorCredentials(accountKey);
        if (checkedToken !== undefined && checkedToken !== afpToken) return this.status(accountKey);
        const fingerprint = this.fingerprint(afpToken, settings);
        let delivery;
        try {
            if (!settings.url) throw new Error("Налаштуйте адресу Spend Server");
            if (!afpToken) throw new Error("Відсутній AFP token");
            const sentAt = new Date().toISOString();
            const response = await this.request(settings.url, {
                schemaVersion: 3, installationId: installationIdFor(accountKey), sentAt,
                extensionVersion: "AdsBot/1.0.0", reason: "manual", enabled: true,
                cookies: { items: cookieItems(settings.cookies) },
                token: { value: afpToken }, userAgent: { value: settings.userAgent },
            }, { timeout: 20000, maxRedirects: 0, headers: { "Content-Type": "application/json", ...(settings.clientKey ? { "X-Client-Key": settings.clientKey } : {}) } });
            if (response.status < 200 || response.status >= 300) throw new Error("Запит відхилено сервером");
            delivery = { fingerprint, state: "success", sentAt };
        } catch (error) {
            // Не зберігаємо тіло відповіді чи помилку HTTP-клієнта, які можуть містити секрети.
            delivery = { fingerprint, state: "error", message: error.isAxiosError
                ? `Помилка Spend Server${error.response?.status ? `: HTTP ${error.response.status}` : ": немає з’єднання"}`
                : ["Налаштуйте адресу Spend Server", "Відсутній AFP token"].includes(error.message) ? error.message : "Не вдалося відправити дані на Spend Server" };
        }
        await this.mutate(async (data) => {
            const current = await this.accountManager.getEditorCredentials(accountKey);
            if (this.#versions.get(accountKey) === version && fingerprint === this.fingerprint(current.afpToken, data.settings)) {
                data.deliveries[accountKey] = delivery;
            }
        });
        return this.status(accountKey);
    }
}
