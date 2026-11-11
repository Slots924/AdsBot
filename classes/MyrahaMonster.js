import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import axios from "axios";

export const defaultMyrahaMonsterUrl = "https://myrahamonster.xyz/api/v1";

function failure(message, code, httpStatus = null) {
    return Object.assign(new Error(message), { code, httpStatus });
}

function normalizeUrl(value) {
    let url;
    try { url = new URL(String(value).trim()); } catch { throw failure("Некоректна адреса API MyrahaMonster", "MYRAHA_CONFIG"); }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw failure("Адреса API MyrahaMonster має бути HTTPS без пароля, параметрів і фрагмента", "MYRAHA_CONFIG");
    }
    return url.href.replace(/\/+$/, "");
}

function normalizePage(value, expectedId) {
    if (!value || typeof value.id !== "string" || !/^\d+$/.test(value.id)
        || (expectedId && value.id !== expectedId) || typeof value.enabled !== "boolean"
        || typeof value.integrationReady !== "boolean") {
        throw failure("MyrahaMonster повернув некоректний стан фанпейджі", "MYRAHA_RESPONSE");
    }
    return { id: value.id, enabled: value.enabled, integrationReady: value.integrationReady };
}

function pageId(value) {
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw failure("Некоректний ID фанпейджі", "MYRAHA_INPUT");
    return value;
}

export default class MyrahaMonster {
    #settingsOperation = Promise.resolve();
    #revision = 0;
    #cacheSequence = 0;
    #cachedVersions = new Map();
    #activePages = new Map();

    constructor({ settingsFile, cacheFile = `${settingsFile}.pages-cache.json`, encrypt, decrypt, httpRequest = axios }) {
        this.settingsFile = settingsFile;
        this.cacheFile = cacheFile;
        this.encrypt = encrypt;
        this.decrypt = decrypt;
        this.httpRequest = httpRequest;
    }

    #settingsTask(task) {
        const operation = this.#settingsOperation.then(task);
        this.#settingsOperation = operation.catch(() => {});
        return operation;
    }

    async #readSettings() {
        let stored;
        try { stored = JSON.parse(await readFile(this.settingsFile, "utf8")); }
        catch (error) {
            if (error.code === "ENOENT") return { baseUrl: defaultMyrahaMonsterUrl, apiKey: "" };
            throw failure("Не вдалося прочитати налаштування MyrahaMonster", "MYRAHA_STORAGE");
        }
        try { return { baseUrl: normalizeUrl(stored.baseUrl), apiKey: stored.apiKey ? this.decrypt(stored.apiKey) : "" }; }
        catch { throw failure("Не вдалося розшифрувати налаштування MyrahaMonster", "MYRAHA_STORAGE"); }
    }

    getSettings() {
        return this.#settingsTask(async () => {
            const settings = await this.#readSettings();
            return { baseUrl: settings.baseUrl, hasApiKey: Boolean(settings.apiKey), revision: this.#revision };
        });
    }

    async #readPagesCache() {
        try {
            const stored = JSON.parse(await readFile(this.cacheFile, "utf8"));
            return Array.isArray(stored.items) ? stored.items.map((item) => normalizePage(item)) : null;
        } catch (error) {
            if (error.code === "ENOENT" || error instanceof SyntaxError || error.code === "MYRAHA_RESPONSE") return null;
            throw failure("Не вдалося прочитати кеш MyrahaMonster", "MYRAHA_STORAGE");
        }
    }

    async #writePagesCache(items) {
        try {
            await mkdir(path.dirname(this.cacheFile), { recursive: true });
            await writeFile(`${this.cacheFile}.tmp`, JSON.stringify({ version: 1, items }), "utf8");
            await rename(`${this.cacheFile}.tmp`, this.cacheFile);
        } catch {
            throw failure("Не вдалося зберегти кеш MyrahaMonster", "MYRAHA_STORAGE");
        }
    }

    getCachedPages() {
        return this.#settingsTask(async () => {
            const settings = await this.#readSettings();
            return { items: settings.apiKey ? await this.#readPagesCache() : null, revision: this.#revision };
        });
    }

    #cachePages(settings, items, sequence, replace = false, protectedIds = new Set()) {
        return this.#settingsTask(async () => {
            this.#assertCurrent(settings);
            if (replace) for (const id of this.#activePages.keys()) protectedIds.add(id);
            const previous = new Map((await this.#readPagesCache() ?? []).map((item) => [item.id, item]));
            const pages = replace ? new Map() : new Map(previous);
            for (const item of items) {
                if (protectedIds.has(item.id) || (this.#cachedVersions.get(item.id) ?? 0) > sequence) continue;
                pages.set(item.id, normalizePage({ integrationReady: false, ...previous.get(item.id), ...item }));
            }
            // Запізнілий список не повинен перезаписати підтверджене новіше перемикання.
            for (const [id, item] of previous) {
                if (protectedIds.has(id) || (this.#cachedVersions.get(id) ?? 0) > sequence) pages.set(id, item);
            }
            await this.#writePagesCache([...pages.values()]);
            const changedIds = replace ? new Set([...previous.keys(), ...pages.keys()]) : items.map((item) => item.id);
            for (const id of changedIds) {
                if (protectedIds.has(id)) continue;
                this.#cachedVersions.set(id, Math.max(sequence, this.#cachedVersions.get(id) ?? 0));
            }
        });
    }

    async #pageTask(id, task) {
        this.#activePages.set(id, (this.#activePages.get(id) ?? 0) + 1);
        try { return await task(); }
        finally {
            const count = this.#activePages.get(id) - 1;
            if (count) this.#activePages.set(id, count);
            else this.#activePages.delete(id);
        }
    }

    saveSettings(input = {}) {
        return this.#settingsTask(async () => {
            const current = await this.#readSettings();
            const baseUrl = normalizeUrl(input.baseUrl ?? current.baseUrl);
            const apiKey = input.removeApiKey === true ? "" : String(input.apiKey ?? "").trim() || current.apiKey;
            if (apiKey && /[^\x21-\x7E]/.test(apiKey)) throw failure("Некоректний API-ключ MyrahaMonster", "MYRAHA_CONFIG");
            // Кеш попередньої інтеграції не переносимо на інший ключ або сервер.
            await this.#writePagesCache(null);
            try {
                const stored = { baseUrl, apiKey: apiKey ? this.encrypt(apiKey) : "" };
                await mkdir(path.dirname(this.settingsFile), { recursive: true });
                await writeFile(`${this.settingsFile}.tmp`, JSON.stringify(stored), { mode: 0o600 });
                await rename(`${this.settingsFile}.tmp`, this.settingsFile);
            } catch { throw failure("Не вдалося зберегти налаштування MyrahaMonster", "MYRAHA_STORAGE"); }
            this.#revision += 1;
            return { baseUrl, hasApiKey: Boolean(apiKey), revision: this.#revision };
        });
    }

    #snapshot() {
        return this.#settingsTask(async () => ({ ...await this.#readSettings(), revision: this.#revision }));
    }

    #assertCurrent(settings) {
        if (settings.revision !== this.#revision) throw failure("Налаштування MyrahaMonster змінилися. Оновіть стан.", "MYRAHA_STALE");
    }

    async request(method, endpoint, { settings, data, params } = {}) {
        settings ??= await this.#snapshot();
        this.#assertCurrent(settings);
        if (!settings.apiKey) throw failure("Додайте API-ключ MyrahaMonster у налаштуваннях інтеграцій", "MYRAHA_NO_KEY");
        let response;
        try {
            response = await this.httpRequest({ method, url: `${settings.baseUrl}${endpoint}`, data, params,
                headers: { Authorization: `Bearer ${settings.apiKey}`, Accept: "application/json" },
                timeout: 30000, maxRedirects: 0, validateStatus: () => true });
        } catch {
            this.#assertCurrent(settings);
            throw failure("Не вдалося отримати відповідь MyrahaMonster", "MYRAHA_NETWORK");
        }
        this.#assertCurrent(settings);
        const messages = {
            400: "MyrahaMonster відхилив запит", 401: "API-ключ MyrahaMonster недійсний",
            403: "Недостатньо прав у MyrahaMonster", 404: "Фанпейджа недоступна в MyrahaMonster",
            429: "Перевищено ліміт MyrahaMonster: 120 запитів на хвилину. Спробуйте пізніше.",
            503: "MyrahaMonster тимчасово недоступний",
        };
        if (response.status < 200 || response.status >= 300) {
            throw failure(messages[response.status] || `MyrahaMonster повернув HTTP ${response.status}`, "MYRAHA_HTTP", response.status);
        }
        return response.data;
    }

    async getPages() {
        const settings = await this.#snapshot();
        const sequence = ++this.#cacheSequence;
        const protectedIds = new Set(this.#activePages.keys());
        const items = new Map();
        let page = 1;
        let received = 0;
        while (true) {
            const result = await this.request("get", "/pages", { settings, params: { page } });
            if (!Array.isArray(result?.items) || result.page !== page || !Number.isSafeInteger(result.total)
                || result.total < 0 || !Number.isSafeInteger(result.pageSize) || result.pageSize < 1
                || result.items.length > result.pageSize || (received + result.items.length < result.total && !result.items.length)) {
                throw failure("MyrahaMonster повернув некоректний список фанпейджів", "MYRAHA_RESPONSE");
            }
            for (const item of result.items) {
                const normalized = normalizePage(item);
                if (items.has(normalized.id)) throw failure("Список MyrahaMonster змінився під час завантаження. Оновіть стан.", "MYRAHA_RESPONSE");
                items.set(normalized.id, normalized);
            }
            received += result.items.length;
            if (received >= result.total) break;
            page += 1;
        }
        const pages = [...items.values()];
        await this.#cachePages(settings, pages, sequence, true, protectedIds);
        return { items: pages, revision: settings.revision };
    }

    async getPage(id) {
        id = pageId(id);
        return this.#pageTask(id, async () => {
            const settings = await this.#snapshot();
            const sequence = ++this.#cacheSequence;
            const item = normalizePage(await this.request("get", `/pages/${id}`, { settings }), id);
            await this.#cachePages(settings, [item], sequence);
            return { ...item, revision: settings.revision };
        });
    }

    async setModeration(id, enabled) {
        id = pageId(id);
        if (typeof enabled !== "boolean") throw failure("Стан автоприховування має бути логічним значенням", "MYRAHA_INPUT");
        return this.#pageTask(id, async () => {
            const settings = await this.#snapshot();
            const sequence = ++this.#cacheSequence;
            try {
                const result = await this.request("patch", `/pages/${id}/moderation`, { settings, data: { enabled } });
                if (result?.id !== id || typeof result.enabled !== "boolean") {
                    throw failure("Не вдалося підтвердити стан MyrahaMonster", "MYRAHA_RESPONSE");
                }
                await this.#cachePages(settings, [{ id, enabled: result.enabled }], sequence);
                return { id, enabled: result.enabled, revision: settings.revision };
            } catch (error) {
                if (!["MYRAHA_NETWORK", "MYRAHA_RESPONSE"].includes(error.code)) throw error;
                try {
                    const item = normalizePage(await this.request("get", `/pages/${id}`, { settings }), id);
                    await this.#cachePages(settings, [item], sequence);
                    return { ...item, revision: settings.revision, reconciled: true };
                } catch (checkError) {
                    if (checkError.code === "MYRAHA_STALE" || [401, 403, 404].includes(checkError.httpStatus)) throw checkError;
                    throw Object.assign(failure("Стан автоприховування невідомий. Перевірте стан перед повторним перемиканням.", "MYRAHA_UNKNOWN"), { outcomeUnknown: true });
                }
            }
        });
    }
}
