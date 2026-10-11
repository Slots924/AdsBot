import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, open } from "node:fs/promises";
import path from "node:path";

import readImageDimensions from "../images/readImageDimensions.js";
import campaignDateRange from "../campaigns/campaignDateRange.js";


const sensitiveKeyPattern = /(?:access.?token|cookie|authorization|password|secret|credential|proxy)/i;


function emptyStore() {
    return {
        version: 2,
        workspaces: {},
        posts: {},
        campaigns: {},
        statistics: {},
        lastStatistics: {},
        pages: {},
        adAccounts: {},
        postRevisions: {},
        revisions: { workspace: 0 },
        businessManagers: {},
    };
}

const metricFields = ["leads", "spend", "costPerLead", "impressions", "clicks", "cpm", "ctr", "metaLeads", "leadSource", "leadSyncStatus"];
const accessFields = new Set(["tasks", "permissions", "isFavorite", "favoritePosition", "accessUnavailable"]);
const pickMetrics = (campaign, fields = metricFields) => Object.fromEntries(fields
    .filter((field) => campaign[field] !== undefined).map((field) => [field, campaign[field]]));
const campaignDetails = (campaign) => Object.fromEntries(Object.entries(campaign)
    .filter(([field]) => !metricFields.includes(field)));
const sharedDetails = (entity) => Object.fromEntries(Object.entries(entity)
    .filter(([field, value]) => !accessFields.has(field) && value !== null && value !== undefined));
const mergeById = (previous = [], next = []) => {
    const items = new Map(previous.map((item) => [String(item.id), item]));
    for (const item of next) items.set(String(item.id), { ...items.get(String(item.id)), ...item });
    return [...items.values()];
};


function normalizedPart(value, code) {
    const part = String(value ?? "").trim();
    if (!part) {
        throw Object.assign(new Error("Не вказано ключ кешу"), { code });
    }
    return part;
}


function safeClone(value) {
    if (Array.isArray(value)) return value.map(safeClone);
    if (typeof value === "string") {
        if (
            /^data:image\/(?:jpeg|png|webp);base64,/i.test(value)
            || cachedImageUrl(value)
        ) return value;
        return value
            .replace(/EAA[A-Za-z0-9_-]+/g, "[REDACTED]")
            .replace(/((?:access_)?token|cookie|authorization|password|secret|api[_-]?key)=([^&\s]+)/gi, "$1=[REDACTED]")
            .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
    }
    if (!value || typeof value !== "object") return value;

    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !sensitiveKeyPattern.test(key))
        .map(([key, child]) => [key, safeClone(child)]));
}


function cacheEntry(value) {
    return {
        value: safeClone(value),
        updatedAt: new Date().toISOString(),
    };
}


function cachedImageUrl(value) {
    return String(value ?? "").startsWith("adsbot-cache://image/");
}


function mergeEntityImages(nextItems, previousItems, imageField) {
    const previousById = new Map((previousItems ?? []).map((item) => [
        String(item?.id ?? item?.postId ?? ""),
        item,
    ]));
    return (nextItems ?? []).map((item) => {
        const previous = previousById.get(String(item?.id ?? item?.postId ?? ""));
        if (
            cachedImageUrl(previous?.[imageField])
            && !cachedImageUrl(item?.[imageField])
        ) {
            return { ...item, [imageField]: previous[imageField] };
        }
        return item;
    });
}


export default class RemoteDataCacheStore {
    #operation = Promise.resolve();
    #loaded = null;
    #loading = null;
    #listeners = new Set();


    constructor({
        cacheFile = "./data/gui-remote-cache.json",
        imagesDirectory = path.join(path.dirname(cacheFile), "gui-cache-images"),
        now = () => new Date(),
    } = {}) {
        this.cacheFile = cacheFile;
        this.imagesDirectory = imagesDirectory;
        this.now = now;
    }

    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }


    async getWorkspace(accountKey) {
        const store = await this.#read();
        const entry = store.workspaces[
            normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED")
        ];
        if (!entry) return null;
        const value = { ...entry.value };
        value.cacheRevision = store.revisions.workspace;
        for (const kind of ["pages", "adAccounts"]) {
            value[kind] = (value[kind] ?? []).map((item) => ({
                ...item, ...store[kind][String(item.id)]?.value,
                ...Object.fromEntries(Object.entries(item).filter(([field]) => accessFields.has(field))),
                ...(kind === "pages" ? { cachedAt: store[kind][String(item.id)]?.updatedAt ?? entry.updatedAt } : {}),
            }));
        }
        return safeClone({ ...entry, value });
    }

    async getBusinessData(key) {
        return safeClone((await this.#read()).businessManagers[normalizedPart(key, "CACHE_BUSINESS_KEY_REQUIRED")] ?? null);
    }

    setBusinessData(key, value) {
        return this.#update((store) => {
            store.businessManagers[normalizedPart(key, "CACHE_BUSINESS_KEY_REQUIRED")] = cacheEntry(value);
        });
    }


    async getWorkspaceRevision() {
        return (await this.#read()).revisions.workspace;
    }

    setWorkspace(accountKey, workspace, options = {}) {
        return this.setWorkspacePart(accountKey, workspace, options);
    }


    setWorkspacePart(accountKey, patch, { expectedRevision } = {}) {
        return this.#update(async (store) => {
            const key = normalizedPart(
                accountKey,
                "CACHE_ACCOUNT_KEY_REQUIRED"
            );
            const current = store.workspaces[key]?.value ?? {
                adAccounts: [],
                pages: [],
            };
            const prepared = await this.#externalizeImages(safeClone(patch));
            const stale = expectedRevision !== undefined && expectedRevision !== store.revisions.workspace;
            for (const kind of ["pages", "adAccounts"]) {
                if (!Array.isArray(prepared[kind])) continue;
                for (const item of prepared[kind]) {
                    const id = String(item.id);
                    const previous = store[kind][id]?.value;
                    if (stale && previous) continue;
                    const [merged] = mergeEntityImages([
                        { ...previous, ...sharedDetails(item) },
                    ], previous ? [previous] : [], "pictureUrl");
                    store[kind][id] = cacheEntry(merged);
                }
                if (stale) prepared[kind] = mergeById(prepared[kind], current[kind]);
                else {
                    const ids = new Set(prepared[kind].map((item) => String(item.id)));
                    prepared[kind] = [
                        ...prepared[kind].map((item) => ({
                            ...item,
                            ...((current[kind] ?? []).some((old) => String(old.id) === String(item.id) && old.accessUnavailable)
                                ? { accessUnavailable: false } : {}),
                        })),
                        ...(current[kind] ?? []).filter((item) => !ids.has(String(item.id))).map((item) => ({ ...item, accessUnavailable: true })),
                    ];
                }
            }
            store.workspaces[key] = cacheEntry({
                ...current,
                ...prepared,
            });
            store.revisions.workspace += 1;
        }, { kind: "workspace", accountKey });
    }


    async getPosts(accountKey, pageId, kind = "links") {
        const store = await this.#read();
        return safeClone(store.posts[
            this.#postsKey(accountKey, pageId, kind)
        ] ?? null);
    }


    setPosts(accountKey, pageId, posts, kind = "links", { expectedRevision } = {}) {
        return this.#update(async (store) => {
            if (expectedRevision !== undefined && (store.postRevisions[pageId] ?? 0) !== expectedRevision) return false;
            const key = this.#postsKey(accountKey, pageId, kind);
            const prepared = await this.#externalizeImages(
                Array.isArray(posts) ? posts : []
            );
            store.posts[key] = cacheEntry(mergeEntityImages(
                prepared,
                store.posts[key]?.value,
                "thumbnailUrl"
            ));
            if (kind === "campaign") {
                store.posts[this.#postsKey(accountKey, pageId, "links")] = cacheEntry(store.posts[key].value.filter((post) => /https?:\/\//i.test(String(post.message ?? ""))));
            }
            store.postRevisions[pageId] = (store.postRevisions[pageId] ?? 0) + 1;
        }, { kind: "posts", pageId });
    }

    async getPostRevision(pageId) {
        return (await this.#read()).postRevisions[pageId] ?? 0;
    }


    clearPosts(accountKey, pageId) {
        return this.#update((store) => {
            for (const kind of ["links", "campaign"]) {
                store.posts[this.#postsKey(accountKey, pageId, kind)] = cacheEntry([]);
            }
            store.postRevisions[pageId] = (store.postRevisions[pageId] ?? 0) + 1;
        }, { kind: "posts", pageId });
    }


    removePosts(accountKey, pageId, postIds = []) {
        return this.#update((store) => {
            const removed = new Set(postIds.map((post) => String(
                typeof post === "object" ? post?.id ?? post?.postId : post
            )));
            for (const kind of ["links", "campaign"]) {
                const entry = store.posts[this.#postsKey(accountKey, pageId, kind)];
                if (!entry) continue;
                entry.value = (Array.isArray(entry.value) ? entry.value : [])
                    .filter((post) => !removed.has(String(post?.id ?? post?.postId)));
                entry.updatedAt = new Date().toISOString();
            }
            store.postRevisions[pageId] = (store.postRevisions[pageId] ?? 0) + 1;
        }, { kind: "posts", pageId });
    }


    prependPost(accountKey, pageId, post, { removedPostIds = [] } = {}) {
        return this.#update(async (store) => {
            const postId = String(post?.id ?? post?.postId ?? "");
            const prepared = await this.#externalizeImages(safeClone(post));
            const removed = new Set(removedPostIds.map((item) => String(item?.id ?? item)));
            const key = this.#postsKey(accountKey, pageId, "campaign");
            const previous = store.posts[key]?.value ?? store.posts[this.#postsKey(accountKey, pageId, "links")]?.value ?? [];
            const posts = previous.filter((item) => String(item?.id ?? item?.postId) !== postId && !removed.has(String(item?.id ?? item?.postId)));
            const existing = previous.find((item) => String(item.id ?? item.postId) === postId);
            const [merged] = mergeEntityImages([{ ...existing, ...prepared }], existing ? [existing] : [], "thumbnailUrl");
            store.posts[key] = cacheEntry([merged, ...posts].slice(0, 10));
            store.posts[this.#postsKey(accountKey, pageId, "links")] = cacheEntry(store.posts[key].value.filter((item) => /https?:\/\//i.test(String(item.message ?? ""))));
            store.postRevisions[pageId] = (store.postRevisions[pageId] ?? 0) + 1;
        }, { kind: "posts", pageId });
    }


    async getCampaignContext(adAccountId, datePreset = "today") {
        const store = await this.#read();
        return this.#campaignContext(store, adAccountId, datePreset);
    }

    #campaignContext(store, adAccountId, datePreset) {
        return campaignDateRange(datePreset, store.adAccounts[adAccountId]?.value?.timezoneName || "Europe/Kyiv", this.now());
    }

    async getCampaigns(accountKey, adAccountId, datePreset = "today") {
        const store = await this.#read();
        normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED");
        const entry = store.campaigns[normalizedPart(adAccountId, "CACHE_AD_ACCOUNT_ID_REQUIRED")];
        if (!entry) return null;
        const context = this.#campaignContext(store, adAccountId, datePreset);
        const statisticsKey = `${adAccountId}::${context.rangeKey}`;
        const current = store.statistics[statisticsKey];
        const fallback = store.lastStatistics[`${adAccountId}::${datePreset}`];
        const statistics = current?.value.complete ? current : fallback ?? current;
        const metrics = { ...statistics?.value?.metrics, ...current?.value?.metrics };
        return safeClone({
            ...entry,
            value: {
                ...entry.value,
                adAccountId, datePreset, context,
                campaigns: entry.value.campaigns.map((campaign) => ({
                    ...Object.fromEntries(metricFields.map((field) => [field, null])),
                    ...campaign, ...metrics[String(campaign.id)],
                })),
                statisticsUpdatedAt: statistics?.value?.statisticsUpdatedAt ?? null,
                statisticsRange: statistics?.value?.context ?? null,
                statisticsStale: Boolean(statistics && !current?.value.complete),
                statisticsMissing: !statistics,
                listUpdatedAt: entry.updatedAt,
                revision: entry.revision ?? 0,
            },
        });
    }


    setCampaigns(accountKey, adAccountId, datePreset, data, {
        mode = "all", expectedRevision, context, fields = metricFields, partial = false,
    } = {}) {
        return this.#update((store) => {
            normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED");
            normalizedPart(adAccountId, "CACHE_AD_ACCOUNT_ID_REQUIRED");
            const previous = store.campaigns[adAccountId];
            if (expectedRevision !== undefined && (previous?.revision ?? 0) !== expectedRevision) return false;
            const campaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
            if (mode !== "statistics") {
                store.campaigns[adAccountId] = {
                    ...cacheEntry({
                        ...previous?.value,
                        includeDeleted: Boolean(previous?.value?.includeDeleted || data.includeDeleted),
                        campaigns: mergeById(
                            (previous?.value?.campaigns ?? []).map((item) => ({ ...item, missingFromLatestRead: true })),
                            campaigns.map((item) => ({ ...campaignDetails(item), missingFromLatestRead: false }))
                        ),
                    }),
                    revision: (previous?.revision ?? 0) + 1,
                };
            } else if (previous) {
                previous.revision = (previous.revision ?? 0) + 1;
            }
            if (mode !== "list" && data.statisticsUpdatedAt) {
                const range = context ?? this.#campaignContext(store, adAccountId, datePreset);
                const key = `${adAccountId}::${range.rangeKey}`;
                const old = store.statistics[key]?.value;
                const metrics = { ...old?.metrics };
                for (const campaign of campaigns) {
                    metrics[campaign.id] = { ...metrics[campaign.id], ...pickMetrics(campaign, fields) };
                }
                const entry = cacheEntry({
                    metrics, context: range,
                    complete: !partial && fields.includes("spend") ? true : old?.complete ?? false,
                    statisticsUpdatedAt: !partial && fields.includes("spend") ? data.statisticsUpdatedAt : old?.statisticsUpdatedAt ?? null,
                });
                store.statistics[key] = entry;
                if (entry.value.complete) store.lastStatistics[`${adAccountId}::${datePreset}`] = entry;
            }
        }, { kind: "campaigns", adAccountId });
    }


    invalidateCampaigns(accountKey, adAccountId) {
        return this.#update((store) => {
            const entry = store.campaigns[adAccountId];
            if (entry) {
                entry.value.needsRefresh = true;
                entry.revision = (entry.revision ?? 0) + 1;
            }
        }, { kind: "campaigns", adAccountId });
    }

    patchCampaign(accountKey, adAccountId, campaign, { expectedRevision } = {}) {
        return this.#update((store) => {
            normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED");
            normalizedPart(adAccountId, "CACHE_AD_ACCOUNT_ID_REQUIRED");
            normalizedPart(campaign?.id, "CACHE_CAMPAIGN_ID_REQUIRED");
            const previous = store.campaigns[adAccountId];
            if (expectedRevision !== undefined && (previous?.revision ?? 0) !== expectedRevision) return false;
            store.campaigns[adAccountId] = {
                ...cacheEntry({
                    ...previous?.value,
                    campaigns: mergeById(previous?.value?.campaigns, [{ ...campaignDetails(campaign), missingFromLatestRead: false }]),
                }),
                revision: (previous?.revision ?? 0) + 1,
            };
        }, { kind: "campaigns", adAccountId });
    }


    #postsKey(accountKey, pageId, kind = "links") {
        return [
            normalizedPart(pageId, "CACHE_PAGE_ID_REQUIRED"),
            normalizedPart(kind, "CACHE_POST_KIND_REQUIRED"),
        ].join("::");
    }


    #update(mutator, event = null) {
        const operation = this.#operation.then(async () => {
            const store = structuredClone(await this.#read());
            if (await mutator(store) === false) return false;
            await this.#write(store);
            this.#loaded = store;
            if (event) for (const listener of this.#listeners) {
                try { listener(event); } catch { /* Помилка підписника не скасовує запис кешу. */ }
            }
            return true;
        });
        this.#operation = operation.catch((error) => {
            for (const listener of this.#listeners) {
                try { listener({ kind: "write-failed", message: "Не вдалося зберегти останні зміни на диск", code: error.code }); } catch { /* Зберігаємо початкову помилку запису. */ }
            }
        });
        return operation;
    }


    async #read() {
        if (this.#loaded) return this.#loaded;
        if (!this.#loading) this.#loading = this.#load().finally(() => { this.#loading = null; });
        return this.#loading;
    }

    async #load() {
        let parsed;
        let recovered = false;
        try {
            parsed = await this.#readValidated(this.cacheFile);
        } catch (error) {
            try {
                parsed = await this.#readValidated(`${this.cacheFile}.bak`);
                recovered = true;
            } catch (backupError) {
                if (error.code === "ENOENT" && backupError.code === "ENOENT") {
                    this.#loaded = emptyStore();
                    return this.#loaded;
                }
                throw Object.assign(new Error("Не вдалося прочитати кеш і резервну копію. Збережені файли залишено для відновлення."), {
                    code: "REMOTE_CACHE_READ_FAILED", cause: error,
                });
            }
        }
        const store = parsed.version === 1 ? this.#migrate(parsed) : { ...emptyStore(), ...safeClone(parsed) };
        this.#loaded = await this.#externalizeImages(store);
        if (recovered) for (const listener of this.#listeners) {
            try { listener({ kind: "recovered", message: "Кеш відновлено з резервної копії" }); } catch { /* Дані вже відновлено. */ }
        }
        return this.#loaded;
    }

    async #readValidated(file) {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        if (![1, 2].includes(parsed?.version)) throw new SyntaxError("Невідома версія кешу");
        const object = (value) => value && typeof value === "object" && !Array.isArray(value);
        for (const key of Object.keys(emptyStore()).filter((key) => key !== "version")) {
            if (parsed[key] !== undefined && !object(parsed[key])) throw new SyntaxError("Пошкоджена структура кешу");
        }
        for (const key of ["workspaces", "posts", "campaigns", "statistics", "lastStatistics", "pages", "adAccounts"]) {
            for (const entry of Object.values(parsed[key] ?? {})) {
                if (!object(entry) || (key === "posts" ? !Array.isArray(entry.value) : !object(entry.value))) throw new SyntaxError("Пошкоджений запис кешу");
                if (key === "campaigns" && !Array.isArray(entry.value.campaigns)) throw new SyntaxError("Пошкоджений список кампаній");
                if (["statistics", "lastStatistics"].includes(key) && !object(entry.value.metrics)) throw new SyntaxError("Пошкоджена статистика");
                if (key === "workspaces") for (const part of ["pages", "adAccounts"]) {
                    if (entry.value[part] !== undefined && !Array.isArray(entry.value[part])) throw new SyntaxError("Пошкоджений список об'єктів");
                }
            }
        }
        return parsed;
    }

    #migrate(parsed) {
        const store = { ...emptyStore(), workspaces: safeClone(parsed.workspaces ?? {}), businessManagers: safeClone(parsed.businessManagers ?? {}) };
        const sorted = (items) => Object.entries(items ?? {}).sort(([, a], [, b]) => String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")));
        for (const [, entry] of sorted(store.workspaces)) {
            for (const kind of ["pages", "adAccounts"]) for (const item of entry.value?.[kind] ?? []) {
                const previous = store[kind][item.id]?.value;
                const [merged] = mergeEntityImages([{ ...previous, ...sharedDetails(item) }], previous ? [previous] : [], "pictureUrl");
                store[kind][item.id] = { value: merged, updatedAt: entry.updatedAt };
            }
        }
        for (const [key, entry] of sorted(parsed.posts)) {
            const [, pageId, kind] = key.split("::");
            const target = `${pageId}::${kind}`;
            const posts = mergeById(store.posts[target]?.value, mergeEntityImages(safeClone(entry.value ?? []), store.posts[target]?.value, "thumbnailUrl"))
                .sort((a, b) => String(b.createdTime ?? "").localeCompare(String(a.createdTime ?? ""))).slice(0, 10);
            store.posts[target] = { value: posts, updatedAt: entry.updatedAt };
        }
        for (const [key, entry] of sorted(parsed.campaigns)) {
            const [, adAccountId, preset = "today"] = key.split("::");
            const data = safeClone(entry.value ?? {});
            store.campaigns[adAccountId] = {
                value: {
                    includeDeleted: Boolean(store.campaigns[adAccountId]?.value.includeDeleted || data.includeDeleted),
                    campaigns: mergeById(store.campaigns[adAccountId]?.value.campaigns, (data.campaigns ?? []).map(campaignDetails)),
                }, updatedAt: entry.updatedAt, revision: 0,
            };
            if (data.statisticsUpdatedAt) {
                const context = campaignDateRange(preset, store.adAccounts[adAccountId]?.value?.timezoneName || "Europe/Kyiv", new Date(data.statisticsUpdatedAt));
                const statisticsKey = `${adAccountId}::${context.rangeKey}`;
                const previousMetrics = store.statistics[statisticsKey]?.value.metrics ?? {};
                const metrics = { ...previousMetrics };
                for (const campaign of data.campaigns ?? []) metrics[campaign.id] = { ...metrics[campaign.id], ...pickMetrics(campaign) };
                const statistics = { value: { metrics, context, complete: true, statisticsUpdatedAt: data.statisticsUpdatedAt }, updatedAt: entry.updatedAt };
                store.statistics[statisticsKey] = statistics;
                store.lastStatistics[`${adAccountId}::${preset}`] = statistics;
            }
        }
        return store;
    }


    async #write(store) {
        await mkdir(path.dirname(this.cacheFile), { recursive: true });
        const temporaryFile = `${this.cacheFile}.tmp`;
        await this.#writeSynced(temporaryFile, store);
        // Резервна копія містить останній успішний стан, а не пошкоджений файл.
        const backupFile = `${this.cacheFile}.bak`;
        await this.#writeSynced(`${backupFile}.tmp`, this.#loaded ?? store);
        await rename(`${backupFile}.tmp`, backupFile);
        await rename(temporaryFile, this.cacheFile);
    }

    async #writeSynced(file, store) {
        const handle = await open(file, "w");
        try {
            await handle.writeFile(`${JSON.stringify(store)}\n`, "utf8");
            await handle.sync();
        } finally { await handle.close(); }
    }


    async #externalizeImages(value, key = "") {
        if (Array.isArray(value)) {
            return Promise.all(value.map((item) => this.#externalizeImages(item)));
        }
        if (!value || typeof value !== "object") {
            if (!["pictureUrl", "thumbnailUrl"].includes(key)) return value;
            return this.#writeDataImage(value);
        }
        return Object.fromEntries(await Promise.all(Object.entries(value).map(
            async ([childKey, child]) => [
                childKey,
                await this.#externalizeImages(child, childKey),
            ]
        )));
    }


    async #writeDataImage(value) {
        const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/i
            .exec(String(value ?? ""));
        if (!match) {
            return /^data:image\//i.test(String(value ?? "")) ? null : value;
        }
        const contentType = match[1].toLowerCase();
        const buffer = Buffer.from(match[2], "base64");
        if (contentType === "image/webp") {
            if (
                buffer.length < 12
                || buffer.subarray(0, 4).toString("ascii") !== "RIFF"
                || buffer.subarray(8, 12).toString("ascii") !== "WEBP"
            ) return null;
        } else {
            try {
                readImageDimensions(buffer, contentType);
            } catch {
                return null;
            }
        }
        const digest = createHash("sha256").update(buffer).digest("hex");
        const extension = contentType === "image/png"
            ? "png"
            : contentType === "image/webp" ? "webp" : "jpg";
        const filename = `${digest}.${extension}`;
        await mkdir(this.imagesDirectory, { recursive: true });
        try {
            await writeFile(path.join(this.imagesDirectory, filename), buffer, {
                flag: "wx",
            });
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
        }
        return `adsbot-cache://image/${filename}`;
    }
}


export { safeClone };
