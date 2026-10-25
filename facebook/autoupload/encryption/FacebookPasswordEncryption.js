import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { actionError } from "../graphql/errors.js";

const supportedModule = name => ["FBBrowserPasswordEncryption", "EnvelopeEncryption"].includes(name)
    || /^(tweetnacl(?:-sealedbox-js|-util)?|blakejs)(?:-[\d.]+)?$/.test(name);

// Завантажує актуальні модулі з Facebook CDN; пароль не потрапляє до файлів або журналів.
export default class FacebookPasswordEncryption {
    constructor(client, { signal } = {}) {
        this.client = client;
        this.signal = signal;
        this.definitions = new Map();
        this.modules = new Map();
        this.sandbox = vm.createContext({ window: { crypto: webcrypto }, self: { crypto: webcrypto },
            crypto: webcrypto, Uint8Array, Uint16Array, Uint32Array, Int32Array, Float64Array,
            ArrayBuffer, Promise, atob, btoa, TextEncoder, TextDecoder, Math, Date,
        });
    }

    #capture(source) {
        const definitions = this.definitions;
        try {
            vm.runInNewContext(source, { self: {}, __d(name, dependencies, factory) {
                if (supportedModule(name) && Array.isArray(dependencies) && typeof factory === "function") {
                    definitions.set(name, { dependencies, source: factory.toString() });
                }
            } }, { timeout: 3000 });
        } catch {
            // Деякі пакети мають браузерний bootstrap; уже оголошені модулі залишаються доступними.
        }
    }

    #complete(name, seen = new Set()) {
        if (name === "Promise" || seen.has(name)) return true;
        const definition = this.definitions.get(name);
        if (!definition) return false;
        seen.add(name);
        return definition.dependencies.every(dependency => this.#complete(dependency, seen));
    }

    async load(scriptUrls) {
        if (this.#complete("FBBrowserPasswordEncryption")) return;
        const urls = [...new Set(scriptUrls ?? [])].slice(0, 24);
        for (let index = 0; index < urls.length; index += 3) {
            this.signal?.throwIfAborted();
            const results = await Promise.allSettled(urls.slice(index, index + 3)
                .map(url => this.client.requestStaticResource(url, { signal: this.signal })));
            for (const result of results) if (result.status === "fulfilled") this.#capture(result.value);
            this.signal?.throwIfAborted();
            if (this.#complete("FBBrowserPasswordEncryption")) return;
        }
        throw actionError("Не вдалося завантажити модуль шифрування Facebook з усіма залежностями", "FACEBOOK_ENCRYPTION_MODULE_UNAVAILABLE");
    }

    #require = name => {
        if (name === "Promise") return Promise;
        if (this.modules.has(name)) return this.modules.get(name).exports;
        const definition = this.definitions.get(name);
        if (!definition) throw new Error();
        const module = { exports: {} };
        this.modules.set(name, module);
        const factory = vm.runInContext(`(${definition.source})`, this.sandbox, { timeout: 3000 });
        factory(this.sandbox, this.#require, this.#require, this.#require, module, module.exports, module.exports);
        return module.exports;
    };

    async encrypt({ keyId, publicKey, password, scriptUrls }) {
        if (keyId == null || !Number.isInteger(Number(keyId)) || Number(keyId) < 0 || Number(keyId) > 255
            || !/^[\da-f]{64}$/i.test(String(publicKey ?? "")) || typeof password !== "string" || !password) {
            throw actionError("Відсутній пароль або коректний ключ шифрування", "FACEBOOK_ENCRYPTION_INPUT_INVALID");
        }
        await this.load(scriptUrls);
        this.signal?.throwIfAborted();
        try {
            const result = await this.#require("FBBrowserPasswordEncryption").encryptPassword(
                Number(keyId), publicKey, password, Math.floor(Date.now() / 1000).toString());
            if (typeof result !== "string" || !/^#PWD_BROWSER:\d+:\d+:[A-Za-z\d+/=]+$/.test(result)) throw new Error();
            this.signal?.throwIfAborted();
            return result;
        } catch {
            this.signal?.throwIfAborted();
            throw actionError("Модуль Facebook не зміг зашифрувати пароль", "FACEBOOK_PASSWORD_ENCRYPTION_FAILED");
        }
    }
}
