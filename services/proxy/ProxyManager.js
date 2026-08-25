import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import normalizeStoredProxy, {
    createProxyError,
    normalizeAdsPowerId,
    normalizeRefreshUrl,
    safeStoredProxy,
    serializeStoredProxy,
} from "./normalizeStoredProxy.js";


function nextProxyId(proxies) {
    let max = 0;
    proxies.forEach((proxy) => {
        const match = /^proxy-(\d+)$/.exec(String(proxy.id ?? ""));
        if (match) max = Math.max(max, Number(match[1]));
    });
    return `proxy-${String(max + 1).padStart(3, "0")}`;
}


export default class ProxyManager {
    #operation = Promise.resolve();


    constructor({ proxiesFile = "./data/facebookApi/proxies.json" } = {}) {
        this.proxiesFile = proxiesFile;
    }


    async list() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            return store.proxies.map((proxy) => safeStoredProxy(
                normalizeStoredProxy(proxy)
            ));
        });
    }


    async getById(proxyId) {
        return this.#enqueue(async () => this.#findRaw(await this.#read(), proxyId));
    }


    async create(input = {}) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const proxy = normalizeStoredProxy({
                ...input,
                id: nextProxyId(store.proxies),
            }, store.proxies.length);
            store.proxies.push(proxy);
            await this.#write(store);
            return safeStoredProxy(proxy);
        });
    }


    async update(proxyId, input = {}) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const current = this.#findRaw(store, proxyId);
            const next = normalizeStoredProxy({
                id: current.id,
                adsPowerId: "adsPowerId" in input
                    ? normalizeAdsPowerId(input.adsPowerId)
                    : current.adsPowerId,
                name: "name" in input
                    ? String(input.name ?? "").trim()
                    : current.name,
                type: String(input.type ?? "").trim() || current.type,
                host: String(input.host ?? "").trim() || current.host,
                port: String(input.port ?? "").trim() || current.port,
                username: typeof input.username === "string"
                    ? input.username
                    : current.username,
                password: typeof input.password === "string"
                    ? input.password
                    : current.password,
                refreshUrl: typeof input.refreshUrl === "string"
                    ? normalizeRefreshUrl(input.refreshUrl)
                    : current.refreshUrl,
            });
            store.proxies = store.proxies.map((item) => (
                item.id === current.id ? next : serializeStoredProxy(
                    normalizeStoredProxy(item)
                )
            ));
            await this.#write(store);
            return safeStoredProxy(next);
        });
    }


    async remove(proxyId) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const current = this.#findRaw(store, proxyId);
            store.proxies = store.proxies.filter((item) => item.id !== current.id);
            await this.#write(store);
            return safeStoredProxy(normalizeStoredProxy(current));
        });
    }


    async reorder(orderedIds = []) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const requested = (Array.isArray(orderedIds) ? orderedIds : [])
                .map((id) => String(id ?? "").trim())
                .filter(Boolean);
            const currentIds = store.proxies.map((proxy) => proxy.id);
            const sameSet = requested.length === currentIds.length
                && requested.length === new Set(requested).size
                && requested.every((id) => currentIds.includes(id));
            if (!sameSet) {
                throw createProxyError(
                    "Некоректний порядок проксі",
                    "PROXY_ORDER_INVALID"
                );
            }
            const byId = new Map(store.proxies.map((proxy) => [proxy.id, proxy]));
            store.proxies = requested.map((id) => byId.get(id));
            await this.#write(store);
            return store.proxies.map((proxy) => safeStoredProxy(
                normalizeStoredProxy(proxy)
            ));
        });
    }


    #findRaw(store, proxyId) {
        const id = String(proxyId ?? "").trim();
        const proxy = store.proxies.find((item) => item.id === id);
        if (!proxy) {
            throw createProxyError(
                `Проксі "${id}" не знайдено`,
                "PROXY_NOT_FOUND"
            );
        }
        return normalizeStoredProxy(proxy);
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }


    async #read() {
        try {
            const parsed = JSON.parse(await readFile(this.proxiesFile, "utf8"));
            return {
                ...parsed,
                proxies: Array.isArray(parsed?.proxies) ? parsed.proxies : [],
            };
        } catch (error) {
            if (error.code === "ENOENT") return { proxies: [] };
            throw error;
        }
    }


    async #write(store) {
        await mkdir(path.dirname(this.proxiesFile), { recursive: true });
        const temporaryFile = `${this.proxiesFile}.tmp`;
        await writeFile(
            temporaryFile,
            `${JSON.stringify({
                ...store,
                proxies: store.proxies.map((proxy) => serializeStoredProxy(
                    normalizeStoredProxy(proxy)
                )),
            }, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.proxiesFile);
    }
}
