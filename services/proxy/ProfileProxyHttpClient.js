import ProxyHttpClient from "./ProxyHttpClient.js";

export default class ProfileProxyHttpClient {
    #snapshot;
    #client;

    constructor({ accountKey, profileProxyService, httpClient, checkProxyFn }) {
        this.accountKey = accountKey;
        this.profileProxyService = profileProxyService;
        this.options = { ...(httpClient ? { httpClient } : {}), ...(checkProxyFn ? { checkProxyFn } : {}) };
    }

    async request(config, options) {
        const snapshot = await this.profileProxyService.ensure(this.accountKey);
        const signature = JSON.stringify(snapshot);
        if (signature !== this.#snapshot) {
            this.#client = new ProxyHttpClient({ proxies: [snapshot.proxy], ...this.options });
            this.#snapshot = signature;
        }
        return this.#client.request(config, options);
    }

    get(url, config = {}) {
        return this.request({ ...config, method: "get", url });
    }
}
