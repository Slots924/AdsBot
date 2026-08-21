import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


function normalizeId(value) {
    const id = String(value ?? "").trim();
    if (!id) throw Object.assign(new Error("Не вказано Page ID"), { code: "PAGE_ID_REQUIRED" });
    return id;
}


function emptyStore() {
    return { version: 1, favoritePageIds: [], pages: {} };
}


export default class PagePreferencesStore {
    #operation = Promise.resolve();

    constructor({ preferencesFile = "./data/page-preferences.json" } = {}) {
        this.preferencesFile = preferencesFile;
    }

    enrich(pages = []) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const favorites = new Set(store.favoritePageIds);
            return pages.map((page) => ({
                ...page,
                geo: store.pages[String(page.id)]?.geo ?? "",
                creativeName: store.pages[String(page.id)]?.creativeName ?? "",
                isFavorite: favorites.has(String(page.id)),
            }));
        });
    }

    setFavorite(pageId, isFavorite) {
        return this.#enqueue(async () => {
            const id = normalizeId(pageId);
            const store = await this.#read();
            store.favoritePageIds = isFavorite
                ? store.favoritePageIds.includes(id) ? store.favoritePageIds : [...store.favoritePageIds, id]
                : store.favoritePageIds.filter((current) => current !== id);
            await this.#write(store);
            return { pageId: id, isFavorite: store.favoritePageIds.includes(id) };
        });
    }

    updateMetadata(pageId, patch = {}) {
        return this.#enqueue(async () => {
            const id = normalizeId(pageId);
            const store = await this.#read();
            const current = store.pages[id] ?? { geo: "", creativeName: "" };
            store.pages[id] = {
                geo: patch.geo === undefined
                    ? current.geo
                    : String(patch.geo ?? "").trim().toUpperCase(),
                creativeName: patch.creativeName === undefined
                    ? current.creativeName
                    : String(patch.creativeName ?? "").trim().replace(/^Creo_/i, ""),
            };
            if (store.pages[id].geo && !/^[A-Z]{2}$/.test(store.pages[id].geo)) {
                throw Object.assign(new Error("GEO має бути ISO-кодом із двох літер"), { code: "PAGE_GEO_INVALID" });
            }
            await this.#write(store);
            return { pageId: id, ...store.pages[id] };
        });
    }

    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }

    async #read() {
        try {
            const parsed = JSON.parse(await readFile(this.preferencesFile, "utf8"));
            const pages = {};
            for (const [id, value] of Object.entries(parsed?.pages ?? {})) {
                pages[String(id)] = {
                    geo: String(value?.geo ?? "").trim().toUpperCase(),
                    creativeName: String(value?.creativeName ?? "").trim().replace(/^Creo_/i, ""),
                };
            }
            return {
                version: 1,
                favoritePageIds: [...new Set((parsed?.favoritePageIds ?? []).map(String))],
                pages,
            };
        } catch (error) {
            if (error.code === "ENOENT" || error instanceof SyntaxError) return emptyStore();
            throw error;
        }
    }

    async #write(store) {
        await mkdir(path.dirname(this.preferencesFile), { recursive: true });
        const temporary = `${this.preferencesFile}.tmp`;
        await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        await rename(temporary, this.preferencesFile);
    }
}
