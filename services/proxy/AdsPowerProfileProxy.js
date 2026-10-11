import path from "node:path";
import AdsPower from "../../classes/AdsPower.js";
import FacebookAccountManager from "../../facebook/accounts/FacebookAccountManager.js";
import normalizeProxy from "./normalizeProxy.js";
import ProxyHttpClient from "./ProxyHttpClient.js";

const services = new Map();
let defaultAdsPower;

export function getProfileProxyService({ accountsFile, kind = "api", adsPower, accountManager, onUpdated }) {
    const key = path.resolve(accountsFile);
    if (!services.has(key)) {
        services.set(key, new AdsPowerProfileProxy({
            adsPower: adsPower ?? (defaultAdsPower ??= new AdsPower()),
            accountManager: accountManager ?? new FacebookAccountManager({ accountsFile, kind }),
        }));
    }
    const service = services.get(key);
    if (onUpdated) service.onUpdated = onUpdated;
    return service;
}

export default class AdsPowerProfileProxy {
    #pending = new Map();

    constructor({ adsPower, accountManager }) {
        this.adsPower = adsPower;
        this.accountManager = accountManager;
    }

    ensure(accountKey) {
        return this.#pending.get(accountKey) ?? this.#run(accountKey, false);
    }

    refresh(accountKey) {
        return this.#run(accountKey, true);
    }

    #run(accountKey, force) {
        const previous = this.#pending.get(accountKey);
        const operation = (previous ? previous.catch(() => {}) : Promise.resolve())
            .then(() => this.#load(accountKey, force));
        this.#pending.set(accountKey, operation);
        operation.finally(() => {
            if (this.#pending.get(accountKey) === operation) this.#pending.delete(accountKey);
        }).catch(() => {});
        return operation;
    }

    async #load(accountKey, force) {
        const account = await this.accountManager.getAdsPowerProxyState(accountKey);
        const profileNo = String(account.adsPowerProfileNo ?? "").trim();
        if (!profileNo) throw new Error("Для отримання проксі вкажіть номер AdsPower-профілю");
        const cached = account.adsPowerProxy;
        if (!force && cached?.profileNo === profileNo && cached?.proxy) {
            try {
                // Перевіряємо повноту збережених даних без мережевого запиту.
                new ProxyHttpClient({ proxies: [cached.proxy] });
                return cached;
            } catch {}
        }
        if (force) {
            // Після невдалого оновлення наступний запит не використовує стару проксі.
            await this.accountManager.setAdsPowerProxy(accountKey, { profileNo, proxy: null, updatedAt: null });
            this.onUpdated?.(accountKey, { hasAdsPowerProxy: false, adsPowerProxyUpdatedAt: null });
        }
        const profile = await this.adsPower.getProfileByNo(profileNo);
        const proxy = { ...normalizeProxy(profile.user_proxy_config), id: `adspower-profile-${profileNo}` };
        new ProxyHttpClient({ proxies: [proxy] });
        const snapshot = { profileNo, proxy, updatedAt: new Date().toISOString() };
        await this.accountManager.setAdsPowerProxy(accountKey, snapshot);
        this.onUpdated?.(accountKey, { hasAdsPowerProxy: true, adsPowerProxyUpdatedAt: snapshot.updatedAt });
        return snapshot;
    }
}
