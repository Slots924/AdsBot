import { safeClone } from "./RemoteDataCacheStore.js";
import { businessAssetTasks, hasFullBusinessAccess } from "../../facebook/api/businessAccess.js";

const itemId = (item) => String(item.id).replace(/^act_/, "");
const errorInfo = (error) => safeClone({ message: error.message, code: error.code, graphCode: error.graphCode, graphSubcode: error.graphSubcode, httpStatus: error.httpStatus });

/** Керує даними БМ, кешем і послідовними змінами доступів. */
export default class BusinessManagerService {
    #locks = new Set();

    constructor({ cache, listAccounts, createClient, logger, onProgress = () => {} }) {
        Object.assign(this, { cache, listAccounts, createClient, logger, onProgress });
    }

    key(accountKey, businessId, section) {
        // Старі списки могли бути обмежені призначеннями юзера або локальним вибором.
        const cacheSection = ["users", "pages", "adAccounts", "pixels"].includes(section) ? `business-v2:${section}` : section;
        return JSON.stringify([accountKey, businessId, cacheSection]);
    }

    async section(client, accountKey, businessId, section, force = false) {
        if (!["users", "adAccounts", "pixels", "pages"].includes(section)) throw new Error("Невідомий розділ БМ");
        const key = this.key(accountKey, businessId, section);
        const cached = await this.cache.getBusinessData(key);
        if (!force) return cached;
        const data = await client.getBusinessManagementSection(businessId, section);
        await this.cache.setBusinessData(key, data);
        return this.cache.getBusinessData(key);
    }

    async execute(payload = {}) {
        payload = { ...payload, accountKey: String(payload.accountKey ?? "").trim(), businessId: String(payload.businessId ?? "").trim() };
        const { action, accountKey, businessId } = payload;
        if (action === "preferences") return (await this.cache.getBusinessData("preferences"))?.value ?? {};
        const accounts = (await this.listAccounts()).filter((item) => ["bm", "system"].includes(item.kind) && !item.archived);
        if (!accounts.some((item) => item.accountKey === accountKey)) throw new Error("Оберіть доступний БМ або системного користувача");
        if (action === "select") {
            await this.cache.setBusinessData("preferences", { accountKey, businessId: String(businessId ?? ""), section: ["users", "adAccounts", "pixels", "pages"].includes(payload.section) ? payload.section : "users" });
            return true;
        }
        if (action === "list" && !payload.force) return this.cache.getBusinessData(this.key(accountKey, "", "list"));
        if (action === "section" && !payload.force) return this.section(null, accountKey, businessId, payload.section);
        const client = await this.createClient(accountKey);
        if (action === "list") {
            let value;
            const account = accounts.find((item) => item.accountKey === accountKey);
            if (account.kind === "system") {
                const known = new Set((await this.cache.getBusinessData(this.key(accountKey, "", "list")))?.value?.map((business) => business.id) ?? []);
                const businessClients = accounts.filter((item) => item.kind === "bm");
                for (const other of businessClients) {
                    const cached = await this.cache.getBusinessData(this.key(other.accountKey, "", "list"));
                    for (const business of cached?.value ?? []) known.add(business.id);
                }
                let discoveryError;
                try { value = await client.getSystemUserBusinessManagers({ knownBusinessIds: [...known] }); }
                catch (error) {
                    if (error.code !== "SYSTEM_USER_BUSINESS_NOT_DISCOVERED") throw error;
                    discoveryError = error;
                }
                if (!value) {
                    for (const other of businessClients) {
                        try {
                            const available = await (await this.createClient(other.accountKey)).getBusinessManagers();
                            for (const business of available) known.add(business.id);
                        } catch (error) {
                            this.logger?.warn?.("bm.system-discovery.candidate-failed", "Не вдалося отримати кандидатів БМ", { error: errorInfo(error) });
                        }
                    }
                    if (known.size) value = await client.getSystemUserBusinessManagers({ knownBusinessIds: [...known] });
                    else throw discoveryError;
                }
            } else value = await client.getBusinessManagers();
            await this.cache.setBusinessData(this.key(accountKey, "", "list"), value);
            this.logger?.info?.("bm.list.completed", "Оновлено список доступних БМ", { accountKey, count: value.length });
            return this.cache.getBusinessData(this.key(accountKey, "", "list"));
        }
        if (!/^\d+$/.test(String(businessId ?? ""))) throw new Error("Оберіть БМ");
        if (action === "section") return this.section(client, accountKey, businessId, payload.section, true);
        if (!["invite", "rename", "removeUser", "removeAccount", "userAssets", "pixelAccounts", "grantAll"].includes(action)) throw new Error("Невідома операція БМ");
        // Один бізнес не змінюється одночасно через різні API-клієнти.
        if (this.#locks.has(businessId)) throw new Error("Для цього БМ уже виконується операція");
        this.#locks.add(businessId);
        const context = { action, accountKey, businessId };
        try {
            if (action === "invite") {
                if (!["EMPLOYEE", "ADMIN"].includes(payload.role)) throw new Error("Некоректна роль запрошення");
                const result = await client.inviteBusinessUser({ businessId, email: payload.email, role: payload.role, financePermission: "FINANCE_EDITOR", useTasks: true });
                if (result === false || result?.success === false) throw new Error("Meta не підтвердила запрошення");
                this.logger?.info?.("bm.invite.completed", "Інвайт до БМ відправлено", { ...context, role: payload.role });
                return { invited: true, ...(await this.refreshAfter(client, context, "users")) };
            }
            if (["rename", "removeUser"].includes(action)) {
                const snapshot = await this.section(client, accountKey, businessId, "users", true);
                this.find(snapshot.value.users, payload.userId);
                if (action === "rename") await client.renameBusinessUser(payload);
                else await client.removeBusinessUser(payload.userId);
                this.logger?.info?.("bm.user.completed", "Користувача БМ змінено", { ...context, userId: payload.userId });
                return this.refreshAfter(client, context, "users");
            }
            if (action === "removeAccount") {
                const snapshot = await this.section(client, accountKey, businessId, "adAccounts", true);
                const account = this.find(snapshot.value.adAccounts, payload.assetId);
                if (account.ownership !== "shared") throw new Error("Meta Graph API не підтримує видалення власного РК із БМ. Відкрийте налаштування Meta");
                await client.removeSharedBusinessAdAccount({ accountId: account.id, businessId });
                this.logger?.info?.("bm.account.removed", "Прибрано наданий РК із БМ", context);
                await this.cache.setBusinessData(this.key(accountKey, businessId, "users"), null);
                await this.cache.setBusinessData(this.key(accountKey, businessId, "pixels"), null);
                return this.refreshAfter(client, context, "adAccounts");
            }
            const section = action === "pixelAccounts" ? "pixels" : "users";
            const snapshot = (await this.section(client, accountKey, businessId, section, true)).value;
            let operations = [];
            if (action === "grantAll") {
                for (const user of snapshot.users) {
                    for (const kind of ["pages", "adAccounts"]) {
                        for (const asset of snapshot[kind]) {
                            if (!hasFullBusinessAccess(asset, user.id, kind)) operations.push({ kind, assetId: asset.id, assetName: asset.name, userId: String(user.id), userName: user.name, enabled: true, assignmentError: asset.assignmentError });
                        }
                    }
                }
                if (payload.retryTargets) {
                    if (!Array.isArray(payload.retryTargets)) throw new Error("Некоректний список повторних спроб");
                    const wanted = new Set(payload.retryTargets);
                    operations = operations.filter((item) => wanted.has(this.operationKey(item)));
                }
            } else {
                const pixel = action === "pixelAccounts" ? this.find(snapshot.pixels, payload.pixelId) : null;
                if (pixel?.assignmentError) throw new Error(pixel.assignmentError.message);
                if (!pixel) this.find(snapshot.users, payload.userId);
                const kind = pixel ? "adAccounts" : payload.kind;
                if (!businessAssetTasks[kind]) throw new Error("Некоректний тип активу");
                const assets = snapshot[kind];
                if (assets.some((asset) => asset.assignmentError)) throw new Error("Не вдалося прочитати всі поточні доступи. Оновіть дані перед зміною");
                const selected = this.normalizeSelection(payload.selectedIds, assets);
                const original = this.normalizeSelection(payload.originalIds, assets, true);
                const current = new Set(assets.filter((asset) => pixel
                    ? pixel.sharedAccounts.some((account) => itemId(account) === itemId(asset))
                    : asset.assignedUsers.some((user) => String(user.id) === String(payload.userId))).map(itemId));
                if (current.size !== original.size || [...current].some((id) => !original.has(id))) throw new Error("Доступи змінилися після відкриття вікна. Оновіть список і повторіть вибір");
                for (const asset of assets) {
                    const enabled = selected.has(itemId(asset));
                    if (enabled ? !current.has(itemId(asset)) || (!pixel && !hasFullBusinessAccess(asset, payload.userId, kind)) : current.has(itemId(asset))) {
                        operations.push({ kind, assetId: asset.id, assetName: asset.name, userId: payload.userId, pixelId: pixel?.id, enabled });
                    }
                }
            }
            const result = { total: operations.length, successful: 0, people: 0, failed: [] };
            const affected = new Set();
            for (const operation of operations) {
                try {
                    if (operation.assignmentError) throw new Error(operation.assignmentError.message);
                    let response;
                    if (operation.pixelId) response = await client.setBusinessPixelAccount({ pixelId: operation.pixelId, accountId: operation.assetId, businessId, enabled: operation.enabled });
                    else if (operation.enabled) response = await client.assignBusinessUserToAsset({ assetId: operation.assetId, userId: operation.userId, businessId, tasks: businessAssetTasks[operation.kind] });
                    else response = await client.removeBusinessUserFromAsset({ assetId: operation.assetId, userId: operation.userId });
                    if (response === false || response?.success === false) throw new Error("Meta не підтвердила зміну доступу");
                    result.successful += 1;
                    if (operation.userId) affected.add(String(operation.userId));
                    this.logger?.info?.("bm.assignment.completed", "Доступ БМ змінено", { ...context, ...operation });
                } catch (error) {
                    const details = errorInfo(error);
                    result.failed.push({ ...operation, error: details, retryable: !String(error.code ?? "").includes("OUTCOME_UNKNOWN"), key: this.operationKey(operation) });
                    this.logger?.error?.("bm.assignment.failed", "Не вдалося змінити доступ БМ", { ...context, ...operation, error: details });
                }
                this.onProgress({ ...context, completed: result.successful + result.failed.length, total: result.total });
            }
            result.people = affected.size;
            this.logger?.info?.("bm.batch.completed", "Операцію доступів БМ завершено", { ...context, ...result });
            return { ...result, ...(await this.refreshAfter(client, context, section)) };
        } catch (error) {
            this.logger?.error?.("bm.operation.failed", "Помилка операції БМ", { ...context, error: errorInfo(error) });
            throw error;
        } finally {
            this.#locks.delete(businessId);
        }
    }

    find(items, id) {
        const item = items.find((entry) => itemId(entry) === String(id ?? "").replace(/^act_/, ""));
        if (!item) throw new Error("Об’єкт відсутній у поточному БМ");
        return item;
    }

    normalizeSelection(ids, assets, allowRemoved = false) {
        if (!Array.isArray(ids)) throw new Error("Некоректний список вибору");
        const selected = new Set(ids.map((id) => String(id).replace(/^act_/, "")));
        if (!allowRemoved && [...selected].some((id) => !assets.some((asset) => itemId(asset) === id))) throw new Error("Вибраний актив більше не доступний у БМ");
        return selected;
    }

    operationKey(item) { return JSON.stringify([item.kind, item.assetId, item.userId]); }

    async refreshAfter(client, context, section) {
        try {
            await this.cache.setBusinessData(this.key(context.accountKey, context.businessId, section), null);
            return { snapshot: await this.section(client, context.accountKey, context.businessId, section, true) };
        } catch (error) {
            const refreshError = errorInfo(error);
            this.logger?.warn?.("bm.refresh.failed", "Зміни виконано, але дані не оновлено", { ...context, error: refreshError });
            return { snapshot: null, refreshError };
        }
    }
}
