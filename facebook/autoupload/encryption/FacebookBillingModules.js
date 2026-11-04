import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { isFacebookScriptUrl } from "../../session/parseScriptUrls.js";
import parseScriptUrls from "../../session/parseScriptUrls.js";
import { actionError } from "../graphql/errors.js";
import billingModuleHints from "./billingModuleHints.js";

// Стандартний адаптер генераторів потрібен публічним фабрикам Meta поза браузерним завантажувачем.
const asyncToGenerator = generator => function (...args) {
    const iterator = generator.apply(this, args);
    return new Promise((resolve, reject) => {
        const step = (method, value) => {
            let result;
            try { result = iterator[method](value); } catch (error) { reject(error); return; }
            if (result.done) resolve(result.value);
            else Promise.resolve(result.value).then(value => step("next", value), error => step("throw", error));
        };
        step("next");
    });
};

// Завантажує публічні фабрики, а приватний bootstrap читає як JSON без виконання inline-коду.
export default class FacebookBillingModules {
    definitions = new Map();
    instances = new Map();
    configs = new Map();
    resourceUrls = new Map();
    resourceMetadata = new Map();
    resourceModules = new Map();
    moduleResources = new Map();
    attempted = new Set();
    downloadAttempts = new Map();
    pendingDownloads = new Map();
    adapters = new Map();
    diagnostics = { downloaded: 0, manifestAttempts: 0, failures: [], missingModules: [] };
    constructor(client, { signal, retryDelayMs = 250 } = {}) {
        Object.assign(this, { client, signal, retryDelayMs });
        this.adapters.set("Promise", Promise);
        this.adapters.set("asyncToGeneratorRuntime", { asyncToGenerator });
        this.adapters.set("err", message => new Error(message));
        this.adapters.set("first", values => values[0]);
        this.adapters.set("flattenArray", values => values.flat());
        this.adapters.set("getErrorSafe", error => error instanceof Error ? error : new Error(String(error)));
        this.adapters.set("promiseDone", (promise, success, failure) => Promise.resolve(promise).then(success, failure));
        this.adapters.set("requireDeferred", name => {
            const deferred = { __setRef: () => deferred, load: async () => {
                await this.loadRoots([name]);
                return this.require(name);
            }, onReady: callback => {
                // Телеметрія Meta не виконується; криптографічні модулі ніколи не підміняються.
                if (name === "PlatformTrustTokenUPLLogger") return;
                callback(this.require(name));
            } };
            return deferred;
        });
        this.sandbox = vm.createContext({ crypto: webcrypto, Uint8Array, Uint16Array, Uint32Array, Int32Array,
            ArrayBuffer, TextEncoder, TextDecoder, atob, btoa, Promise, URL, URLSearchParams, Date, Math,
            setTimeout, clearTimeout, performance, babelHelpers: { extends: Object.assign },
            window: { crypto: webcrypto, atob, btoa }, self: { crypto: webcrypto },
        });
    }
    readPayload(payload) {
        const visit = value => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) {
                if (typeof value[0] === "string" && Array.isArray(value[1]) && value[1].length === 0 && value.length >= 3 && value[2] != null) this.configs.set(value[0], value[2]);
                value.forEach(visit);
            } else {
                for (const [key, item] of Object.entries(value)) {
                    if (["js", "css", "csr"].includes(item?.type) && typeof item.src === "string") {
                        this.resourceMetadata.set(key, { type: item.type, src: item.src, p: item.p });
                    }
                    if (item?.type !== "css" && isFacebookScriptUrl(item?.src)
                        && !new URL(item.src).pathname.endsWith(".css")) this.resourceUrls.set(key, item.src);
                    if (Array.isArray(item?.r)) this.moduleResources.set(key, item.r.map(String));
                    visit(item);
                }
            }
        };
        visit(payload);
    }
    readManifest(html) {
        for (const match of String(html).matchAll(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi)) {
            try { this.readPayload(JSON.parse(match[1])); } catch { /* Невалідний bootstrap не виконується. */ }
        }
        this.initialUrls = parseScriptUrls(html);
    }
    async download(url) {
        this.signal?.throwIfAborted();
        if (!isFacebookScriptUrl(url)) return false;
        if (this.attempted.has(url)) return true;
        if (this.pendingDownloads.has(url)) return this.pendingDownloads.get(url);
        const pending = this.downloadResource(url);
        this.pendingDownloads.set(url, pending);
        try { return await pending; }
        finally { this.pendingDownloads.delete(url); }
    }
    async downloadResource(url) {
        // Повторне читання manifest не скидає ліміт спроб ресурсу.
        const limit = 3;
        while ((this.downloadAttempts.get(url) || 0) < limit) {
            this.signal?.throwIfAborted();
            const attempt = (this.downloadAttempts.get(url) || 0) + 1;
            this.downloadAttempts.set(url, attempt);
            if (attempt > 1 && this.retryDelayMs > 0) await delay(this.retryDelayMs * Math.min(attempt - 1, 4), undefined, { signal: this.signal });
            try {
                const source = await this.client.requestStaticResource(url, { signal: this.signal });
                const captured = new Map();
                const payloads = [];
                const bootloader = {
                    handlePayload: value => payloads.push(value),
                    setResourceMap: value => payloads.push(value),
                    enableBootload: value => payloads.push(value),
                };
                const capture = (name, dependencies, factory) => {
                    if (typeof name === "string" && Array.isArray(dependencies)
                        && dependencies.every(item => typeof item === "string") && typeof factory === "function") {
                        captured.set(name, { dependencies, source: factory.toString() });
                    }
                };
                const requireLazy = (names, callback) => {
                    // Читаємо карти Bootloader без запуску решти браузерного bootstrap.
                    if (names.length === 1 && names[0] === "Bootloader") callback(bootloader);
                };
                const registrationContext = { self: {} };
                // Початковий пакет містить власний завантажувач: він не повинен заміняти збирач фабрик.
                Object.defineProperties(registrationContext, {
                    __d: { get: () => capture, set() {}, configurable: false },
                    requireLazy: { get: () => requireLazy, set() {}, configurable: false },
                });
                vm.runInNewContext(source, registrationContext, { timeout: 3000 });
                if (!captured.size && !payloads.length) throw actionError("Ресурс не містить модулів", "BILLING_RESOURCE_INVALID");
                payloads.forEach(value => this.readPayload(value));
                this.diagnostics.downloaded++;
                this.resourceModules.set(url, [...captured.keys()]);
                for (const [name, definition] of captured) if (!this.definitions.has(name)) this.definitions.set(name, definition);
                this.attempted.add(url);
                return true;
            } catch (error) {
                this.signal?.throwIfAborted();
                this.diagnostics.failures.push({ url, attempt, code: error.code || "BILLING_RESOURCE_INVALID", httpStatus: error.httpStatus || null,
                    errorType: error.name || null, missingGlobal: error.name === "ReferenceError"
                        ? String(error.message).match(/^([A-Za-z_$][\w$]*) is not defined$/)?.[1] || null : null });
                if (error.httpStatus >= 400 && error.httpStatus < 500 && ![408, 429].includes(error.httpStatus)) {
                    this.downloadAttempts.set(url, limit);
                    break;
                }
            }
        }
        return false;
    }
    async loadRoots(names, { refreshManifest, resourceHints = billingModuleHints, resources = [] } = {}) {
        const needed = new Set(names);
        const expand = name => {
            if (this.adapters.has(name)) return;
            for (const dependency of this.definitions.get(name)?.dependencies || []) {
                if (!needed.has(dependency)) { needed.add(dependency); expand(dependency); }
            }
        };
        const available = name => this.definitions.has(name) || this.configs.has(name) || this.adapters.has(name);
        if (!Array.isArray(resourceHints)) throw actionError("Некоректний список ресурсів модулів", "BILLING_RESOURCE_INVALID");
        for (let round = 0; round < 3; round++) {
            const roundUrls = new Set();
            const checkedHints = new Set();
            if (round > 0 && refreshManifest) {
                this.signal?.throwIfAborted();
                this.diagnostics.manifestAttempts++;
                try {
                    const html = await refreshManifest();
                    // Різні ревізії manifest не змішуємо в одному графі залежностей.
                    this.definitions.clear();
                    this.instances.clear();
                    this.configs.clear();
                    this.resourceUrls.clear();
                    this.resourceMetadata.clear();
                    this.resourceModules.clear();
                    this.moduleResources.clear();
                    this.attempted.clear();
                    needed.clear();
                    names.forEach(name => needed.add(name));
                    this.readManifest(html);
                }
                catch (error) {
                    this.signal?.throwIfAborted();
                    if (error.sessionStatus) throw error;
                    this.diagnostics.failures.push({ stage: "manifest", attempt: round, code: error.code || null, httpStatus: error.httpStatus || null });
                }
            }
            if (resources.length) await this.loadResources(resources);
            while (true) {
                [...needed].forEach(expand);
                const relevantHints = resourceHints.filter(hint => !checkedHints.has(hint)
                    && hint.moduleNames?.some(name => needed.has(name)));
                if (relevantHints.length) {
                    await this.loadResourceHints(relevantHints);
                    relevantHints.forEach(hint => checkedHints.add(hint));
                    continue;
                }
                const missing = [...needed].filter(name => !available(name));
                if (!missing.length) { this.diagnostics.missingModules = []; return; }
                const eligible = url => url && !this.attempted.has(url) && !roundUrls.has(url) && (this.downloadAttempts.get(url) || 0) < 3;
                const indexed = [...new Set(missing.flatMap(name => (this.moduleResources.get(name) || [])
                    .map(id => this.resourceUrls.get(id))))].filter(eligible);
                const initial = [...new Set(this.initialUrls || [])].filter(eligible);
                // Після кожного етапу оновлюємо граф, перш ніж розпочинати широкий пошук.
                const urls = indexed.length ? indexed : initial.length ? initial : [...this.resourceUrls.values()].filter(eligible);
                const fresh = [...new Set(urls)].slice(0, 4);
                if (!fresh.length) break;
                fresh.forEach(url => roundUrls.add(url));
                await Promise.all(fresh.map(url => this.download(url)));
            }
            [...needed].forEach(expand);
            this.diagnostics.missingModules = [...needed].filter(name => !available(name));
            if (!this.diagnostics.missingModules.length) return;
        }
        const missing = this.diagnostics.missingModules[0];
        throw actionError(`Не вдалося завантажити модуль ${missing} після повторних спроб`, "BILLING_MODULE_UNAVAILABLE", { moduleName: missing, encryptionDiagnostics: this.diagnostics });
    }
    inspectRoots(names) {
        const needed = new Set(names);
        for (const name of needed) {
            if (this.adapters.has(name) || this.configs.has(name)) continue;
            for (const dependency of this.definitions.get(name)?.dependencies || []) needed.add(dependency);
        }
        const available = name => this.definitions.has(name) || this.configs.has(name) || this.adapters.has(name);
        return { rootStatus: names.map(name => ({ name, available: available(name) })),
            missingModules: [...needed].filter(name => !available(name)), requiredModuleCount: needed.size };
    }
    async loadResources(resources) {
        if (!Array.isArray(resources) || resources.some(item => !isFacebookScriptUrl(item?.url)
            || !Array.isArray(item.moduleNames) || !item.moduleNames.length
            || item.moduleNames.some(name => typeof name !== "string" || !name))) {
            throw actionError("Некоректний опис ресурсу модулів", "BILLING_RESOURCE_INVALID");
        }
        const load = async ({ url, moduleNames }) => {
            if (!await this.download(url)) throw actionError("Не вдалося завантажити ресурс модулів", "BILLING_RESOURCE_UNAVAILABLE", { resourceUrl: url });
            // Перевіряємо визначення саме цього файлу, а не випадковий збіг у вже завантаженому графі.
            const declared = new Set(this.resourceModules.get(url));
            const missingModules = moduleNames.filter(name => !declared.has(name));
            if (missingModules.length) throw actionError("Ресурс не визначає очікувані модулі", "BILLING_RESOURCE_MODULE_MISSING",
                { resourceUrl: url, missingModules });
            return { url, moduleNames, definitionCount: declared.size };
        };
        const results = [];
        for (let offset = 0; offset < resources.length; offset += 4) {
            const batch = await Promise.allSettled(resources.slice(offset, offset + 4).map(load));
            const failed = batch.find(item => item.status === "rejected");
            if (failed) throw failed.reason;
            results.push(...batch.map(item => item.value));
        }
        return results;
    }
    resourceCandidates(referenceUrl) {
        const fileName = typeof referenceUrl === "object" ? referenceUrl?.fileName : null;
        if (fileName ? !/^[A-Za-z0-9_-]+\.js$/.test(fileName) : !isFacebookScriptUrl(referenceUrl)) {
            throw actionError("Некоректна адреса ресурсу модулів", "BILLING_RESOURCE_INVALID");
        }
        const reference = fileName ? null : new URL(referenceUrl);
        const filename = fileName || reference.pathname.split("/").pop();
        const directory = reference?.pathname.match(/^(.*\/l\/)[^/]+\/[^/]+$/)?.[1];
        const current = [...new Set([...(this.initialUrls || []), ...this.resourceUrls.values()])];
        const exact = current.filter(url => new URL(url).pathname.split("/").pop() === filename);
        // Пакет з UI може мати інший хеш у різних мовах; директорія лише звужує пошук.
        const localized = directory ? current.filter(url => new URL(url).pathname.startsWith(directory)) : [];
        return [...new Set([...exact, ...localized])];
    }
    async loadResourceHints(resources) {
        if (!Array.isArray(resources)) throw actionError("Некоректний список ресурсів модулів", "BILLING_RESOURCE_INVALID");
        const results = [];
        for (const { url, fileName, moduleNames } of resources) {
            if (!Array.isArray(moduleNames) || !moduleNames.length || moduleNames.some(name => typeof name !== "string" || !name)) {
                throw actionError("Некоректний опис ресурсу модулів", "BILLING_RESOURCE_INVALID");
            }
            const checked = [];
            let matchedUrl = null;
            for (const candidate of this.resourceCandidates(fileName ? { fileName } : url)) {
                const loaded = await this.download(candidate);
                const declared = new Set(this.resourceModules.get(candidate));
                const missingModules = moduleNames.filter(name => !declared.has(name));
                checked.push({ url: candidate, loaded, missingModules });
                if (loaded && !missingModules.length) { matchedUrl = candidate; break; }
            }
            results.push({ referenceUrl: url || null, fileName: fileName || null, moduleNames, matchedUrl, checked });
        }
        return results;
    }
    require = name => {
        if (this.adapters.has(name)) return this.adapters.get(name);
        if (this.instances.has(name)) return this.instances.get(name).exports;
        if (this.configs.has(name)) return this.configs.get(name);
        const definition = this.definitions.get(name);
        if (!definition) throw actionError(`Не завантажено модуль ${name}`, "BILLING_MODULE_UNAVAILABLE", { moduleName: name, encryptionDiagnostics: this.diagnostics });
        const module = { exports: {} };
        this.instances.set(name, module);
        try {
            const factory = vm.runInContext(`(${definition.source})`, this.sandbox, { timeout: 3000 });
            const requireDefault = name => { const value = this.require(name); return value?.default ?? value; };
            factory(this.sandbox, this.require, requireDefault, this.require, module, module.exports, module.exports);
            return module.exports;
        } catch (error) { this.instances.delete(name); throw error; }
    };
}
