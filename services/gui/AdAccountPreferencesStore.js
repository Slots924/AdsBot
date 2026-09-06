import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


function createPreferencesError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function normalizeId(value, field = "ID рекламного акаунта") {
    const id = String(value ?? "").trim();
    if (!id) {
        throw createPreferencesError(
            `${field} не вказано`,
            "AD_ACCOUNT_ID_REQUIRED"
        );
    }
    return id;
}


function emptyStore() {
    return {
        version: 1,
        nextDefaultNameNumber: 1,
        aliases: {},
        clients: {},
        campaignOrders: {},
    };
}


export default class AdAccountPreferencesStore {
    #operation = Promise.resolve();


    constructor({ preferencesFile = "./data/ad-account-preferences.json" } = {}) {
        this.preferencesFile = preferencesFile;
    }


    async enrichAccounts(accountKey, accounts = []) {
        return this.#enqueue(async () => {
            const clientKey = normalizeId(accountKey, "Ключ API-клієнта");
            const store = await this.#readStore();
            let changed = false;

            for (const account of accounts) {
                const id = normalizeId(account?.id);
                if (!store.aliases[id]) {
                    store.aliases[id] = `Ім’я ${store.nextDefaultNameNumber}`;
                    store.nextDefaultNameNumber += 1;
                    changed = true;
                }
            }

            if (!store.clients[clientKey]) {
                store.clients[clientKey] = { favoriteAdAccountIds: [] };
                changed = true;
            }

            if (changed) {
                await this.#writeStore(store);
            }

            const favoriteIds = store.clients[clientKey].favoriteAdAccountIds;
            const positions = new Map(
                favoriteIds.map((id, index) => [id, index])
            );

            return accounts.map((account) => ({
                ...account,
                localName: store.aliases[String(account.id)],
                isFavorite: positions.has(String(account.id)),
                favoritePosition: positions.get(String(account.id)) ?? null,
            }));
        });
    }


    async rename(adAccountId, name) {
        return this.#enqueue(async () => {
            const id = normalizeId(adAccountId);
            const normalizedName = String(name ?? "").trim();
            if (!normalizedName) {
                throw createPreferencesError(
                    "Вкажіть локальну назву рекламного акаунта",
                    "AD_ACCOUNT_NAME_REQUIRED"
                );
            }

            const store = await this.#readStore();
            if (!store.aliases[id]) {
                throw createPreferencesError(
                    `Рекламний акаунт ${id} ще не зареєстровано локально`,
                    "AD_ACCOUNT_PREFERENCES_NOT_FOUND"
                );
            }
            store.aliases[id] = normalizedName;
            await this.#writeStore(store);
            return { adAccountId: id, localName: normalizedName };
        });
    }


    async setFavorite(accountKey, adAccountId, isFavorite) {
        return this.#enqueue(async () => {
            const clientKey = normalizeId(accountKey, "Ключ API-клієнта");
            const id = normalizeId(adAccountId);
            const store = await this.#readStore();
            const client = store.clients[clientKey]
                ?? { favoriteAdAccountIds: [] };
            const current = client.favoriteAdAccountIds;

            client.favoriteAdAccountIds = isFavorite
                ? current.includes(id) ? current : [...current, id]
                : current.filter((currentId) => currentId !== id);
            store.clients[clientKey] = client;
            await this.#writeStore(store);
            return [...client.favoriteAdAccountIds];
        });
    }


    async reorderFavorites(accountKey, orderedIds = []) {
        return this.#enqueue(async () => {
            const clientKey = normalizeId(accountKey, "Ключ API-клієнта");
            if (!Array.isArray(orderedIds)) {
                throw createPreferencesError(
                    "Порядок обраних РК має бути масивом",
                    "AD_ACCOUNT_ORDER_INVALID"
                );
            }

            const requested = [...new Set(orderedIds.map((id) => normalizeId(id)))];
            const store = await this.#readStore();
            const client = store.clients[clientKey]
                ?? { favoriteAdAccountIds: [] };
            const currentSet = new Set(client.favoriteAdAccountIds);

            if (requested.some((id) => !currentSet.has(id))) {
                throw createPreferencesError(
                    "Порядок містить РК, якого немає серед обраних",
                    "AD_ACCOUNT_ORDER_INVALID"
                );
            }

            const hidden = client.favoriteAdAccountIds.filter(
                (id) => !requested.includes(id)
            );
            client.favoriteAdAccountIds = [...requested, ...hidden];
            store.clients[clientKey] = client;
            await this.#writeStore(store);
            return [...client.favoriteAdAccountIds];
        });
    }


    async enrichCampaigns(adAccountId, campaigns = []) {
        return this.#enqueue(async () => {
            const id = normalizeId(adAccountId);
            if (!Array.isArray(campaigns)) {
                throw createPreferencesError(
                    "Список кампаній має бути масивом",
                    "CAMPAIGN_LIST_INVALID"
                );
            }

            const store = await this.#readStore();
            const campaignIds = [...new Set(campaigns.map((campaign) => (
                normalizeId(campaign?.id, "ID кампанії")
            )))];
            const campaignIdSet = new Set(campaignIds);
            const savedOrder = store.campaignOrders[id] ?? [];
            const knownIds = savedOrder.filter((campaignId) => (
                campaignIdSet.has(campaignId)
            ));
            const knownIdSet = new Set(knownIds);
            const newIds = campaignIds.filter((campaignId) => !knownIdSet.has(campaignId));
            const nextOrder = [...newIds, ...knownIds];

            if (JSON.stringify(savedOrder) !== JSON.stringify(nextOrder)) {
                store.campaignOrders[id] = nextOrder;
                await this.#writeStore(store);
            }

            const positions = new Map(nextOrder.map((campaignId, index) => [
                campaignId,
                index,
            ]));
            return [...campaigns]
                .map((campaign) => ({
                    ...campaign,
                    position: positions.get(String(campaign.id)) ?? Number.MAX_SAFE_INTEGER,
                }))
                .sort((left, right) => left.position - right.position);
        });
    }


    async reorderCampaigns(adAccountId, orderedIds = []) {
        return this.#enqueue(async () => {
            const id = normalizeId(adAccountId);
            if (!Array.isArray(orderedIds)) {
                throw createPreferencesError(
                    "Порядок кампаній має бути масивом",
                    "CAMPAIGN_ORDER_INVALID"
                );
            }

            const requested = [...new Set(orderedIds.map((campaignId) => (
                normalizeId(campaignId, "ID кампанії")
            )))];
            const store = await this.#readStore();
            const current = store.campaignOrders[id] ?? [];
            const requestedSet = new Set(requested);
            store.campaignOrders[id] = [
                ...requested,
                ...current.filter((campaignId) => !requestedSet.has(campaignId)),
            ];
            await this.#writeStore(store);
            return [...store.campaignOrders[id]];
        });
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }


    async #readStore() {
        try {
            const parsed = JSON.parse(
                await readFile(this.preferencesFile, "utf8")
            );
            const aliases = parsed?.aliases && typeof parsed.aliases === "object"
                ? Object.fromEntries(Object.entries(parsed.aliases).map(
                    ([id, name]) => [String(id), String(name)]
                ))
                : {};
            const clients = {};
            const campaignOrders = {};

            if (parsed?.clients && typeof parsed.clients === "object") {
                for (const [accountKey, client] of Object.entries(parsed.clients)) {
                    clients[accountKey] = {
                        favoriteAdAccountIds: Array.isArray(client?.favoriteAdAccountIds)
                            ? [...new Set(client.favoriteAdAccountIds.map(String))]
                            : [],
                    };
                }
            }

            if (parsed?.campaignOrders && typeof parsed.campaignOrders === "object") {
                for (const [adAccountId, campaignIds] of Object.entries(parsed.campaignOrders)) {
                    campaignOrders[String(adAccountId)] = Array.isArray(campaignIds)
                        ? [...new Set(campaignIds.map(String).filter(Boolean))]
                        : [];
                }
            }

            return {
                version: 1,
                nextDefaultNameNumber: Math.max(
                    1,
                    Number(parsed?.nextDefaultNameNumber) || 1
                ),
                aliases,
                clients,
                campaignOrders,
            };
        } catch (error) {
            if (error.code === "ENOENT") {
                return emptyStore();
            }
            throw error;
        }
    }


    async #writeStore(store) {
        await mkdir(path.dirname(this.preferencesFile), { recursive: true });
        const temporaryFile = `${this.preferencesFile}.tmp`;
        await writeFile(
            temporaryFile,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.preferencesFile);
    }
}
