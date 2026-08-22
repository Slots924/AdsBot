import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import readImageDimensions from "../images/readImageDimensions.js";


const sensitiveKeyPattern = /(?:access.?token|cookie|authorization|password|secret|credential|proxy)/i;


function emptyStore() {
    return {
        version: 1,
        workspaces: {},
        posts: {},
        campaigns: {},
    };
}


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


    constructor({
        cacheFile = "./data/gui-remote-cache.json",
        imagesDirectory = path.join(path.dirname(cacheFile), "gui-cache-images"),
    } = {}) {
        this.cacheFile = cacheFile;
        this.imagesDirectory = imagesDirectory;
    }


    async getWorkspace(accountKey) {
        const store = await this.#read();
        return safeClone(store.workspaces[
            normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED")
        ] ?? null);
    }


    setWorkspace(accountKey, workspace) {
        return this.#update(async (store) => {
            const key = normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED");
            const prepared = await this.#externalizeImages(safeClone(workspace));
            prepared.pages = mergeEntityImages(
                prepared.pages,
                store.workspaces[key]?.value?.pages,
                "pictureUrl"
            );
            store.workspaces[key] = cacheEntry(prepared);
        });
    }


    setWorkspacePart(accountKey, patch) {
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
            if (Array.isArray(prepared.pages)) {
                prepared.pages = mergeEntityImages(
                    prepared.pages,
                    current.pages,
                    "pictureUrl"
                );
            }
            store.workspaces[key] = cacheEntry({
                ...current,
                ...prepared,
            });
        });
    }


    async getPosts(accountKey, pageId, kind = "links") {
        const store = await this.#read();
        return safeClone(store.posts[
            this.#postsKey(accountKey, pageId, kind)
        ] ?? null);
    }


    setPosts(accountKey, pageId, posts, kind = "links") {
        return this.#update(async (store) => {
            const key = this.#postsKey(accountKey, pageId, kind);
            const prepared = await this.#externalizeImages(
                Array.isArray(posts) ? posts : []
            );
            store.posts[key] = cacheEntry(mergeEntityImages(
                prepared,
                store.posts[key]?.value,
                "thumbnailUrl"
            ));
        });
    }


    clearPosts(accountKey, pageId) {
        return this.#update((store) => {
            for (const kind of ["links", "campaign"]) {
                store.posts[this.#postsKey(accountKey, pageId, kind)] = cacheEntry([]);
            }
        });
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
        });
    }


    prependPost(accountKey, pageId, post) {
        return this.#update(async (store) => {
            const postId = String(post?.id ?? post?.postId ?? "");
            const prepared = await this.#externalizeImages(safeClone(post));
            for (const kind of ["links", "campaign"]) {
                const key = this.#postsKey(accountKey, pageId, kind);
                const previous = store.posts[key]?.value;
                const posts = (Array.isArray(previous) ? previous : [])
                    .filter((item) => String(item?.id ?? item?.postId) !== postId);
                store.posts[key] = cacheEntry(
                    [prepared, ...posts].slice(0, 10)
                );
            }
        });
    }


    async getCampaigns(accountKey, adAccountId, datePreset) {
        const store = await this.#read();
        return safeClone(store.campaigns[
            this.#campaignsKey(accountKey, adAccountId, datePreset)
        ] ?? null);
    }


    setCampaigns(accountKey, adAccountId, datePreset, campaigns) {
        return this.#update((store) => {
            store.campaigns[
                this.#campaignsKey(accountKey, adAccountId, datePreset)
            ] = cacheEntry(campaigns);
        });
    }


    invalidateCampaigns(accountKey, adAccountId) {
        return this.#update((store) => {
            const prefix = [
                normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED"),
                normalizedPart(adAccountId, "CACHE_AD_ACCOUNT_ID_REQUIRED"),
            ].join("::") + "::";
            for (const key of Object.keys(store.campaigns)) {
                if (key.startsWith(prefix)) delete store.campaigns[key];
            }
        });
    }


    #postsKey(accountKey, pageId, kind = "links") {
        return [
            normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED"),
            normalizedPart(pageId, "CACHE_PAGE_ID_REQUIRED"),
            normalizedPart(kind, "CACHE_POST_KIND_REQUIRED"),
        ].join("::");
    }


    #campaignsKey(accountKey, adAccountId, datePreset) {
        return [
            normalizedPart(accountKey, "CACHE_ACCOUNT_KEY_REQUIRED"),
            normalizedPart(adAccountId, "CACHE_AD_ACCOUNT_ID_REQUIRED"),
            normalizedPart(datePreset || "today", "CACHE_DATE_PRESET_REQUIRED"),
        ].join("::");
    }


    #update(mutator) {
        const operation = this.#operation.then(async () => {
            const store = await this.#read();
            await mutator(store);
            await this.#write(store);
        });
        this.#operation = operation.catch(() => {});
        return operation;
    }


    async #read() {
        if (this.#loaded) return this.#loaded;
        try {
            const parsed = JSON.parse(await readFile(this.cacheFile, "utf8"));
            this.#loaded = {
                ...emptyStore(),
                ...(parsed?.version === 1 ? parsed : {}),
            };
            const beforeMigration = JSON.stringify(this.#loaded);
            this.#loaded = await this.#externalizeImages(this.#loaded);
            if (JSON.stringify(this.#loaded) !== beforeMigration) {
                await this.#write(this.#loaded);
            }
        } catch (error) {
            if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
                throw error;
            }
            this.#loaded = emptyStore();
        }
        return this.#loaded;
    }


    async #write(store) {
        await mkdir(path.dirname(this.cacheFile), { recursive: true });
        const temporaryFile = `${this.cacheFile}.tmp`;
        await writeFile(
            temporaryFile,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.cacheFile);
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
