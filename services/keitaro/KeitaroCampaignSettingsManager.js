import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


export function buildPixelUtm(pixelId, token) {
    return `utm_campaign={{campaign.name}}&utm_source={{site_source_name}}&utm_placement={{placement}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}&adset_name={{adset.name}}&pixel=${String(pixelId).trim()}&ad_name={{ad.name}}&token=${String(token).trim()}`;
}


function normalizePixel(value = {}) {
    const id = String(value.id ?? crypto.randomUUID()).trim();
    const name = String(value.name ?? "").trim();
    const pixelId = String(value.pixelId ?? value.pixel_id ?? "").trim();
    const token = String(value.token ?? "").trim();
    if (!name || !pixelId || !token) {
        throw new Error("Для пікселя потрібні назва, ID і токен");
    }
    return { id, name, pixelId, token, utm: buildPixelUtm(pixelId, token) };
}


function normalizeDomainMapping(value = {}) {
    const id = String(value.id ?? crypto.randomUUID()).trim();
    const name = String(value.name ?? "").trim();
    const geo = String(value.geo ?? "").trim().toUpperCase();
    const domainId = String(value.domainId ?? value.domain_id ?? "").trim();
    if (!/^[A-Z]{2}$/.test(geo) || !domainId) {
        throw new Error("Для GEO-домену потрібні дволітерний GEO і домен");
    }
    return { id, name, geo, domainId };
}


function legacyDomainMappings(domainsByGeo = {}) {
    return Object.entries(domainsByGeo).map(([geo, domainIds]) => {
        const domainId = Array.isArray(domainIds) ? domainIds[0] : domainIds;
        return { id: `legacy:${geo}:${domainId}`, geo, domainId };
    });
}


function normalizeStore(value = {}) {
    const pixels = Array.isArray(value.pixels)
        ? value.pixels.map(normalizePixel)
        : [];
    const ids = new Set(pixels.map((pixel) => pixel.id));
    const sourceMappings = Array.isArray(value.domainMappings)
        ? value.domainMappings
        : legacyDomainMappings(value.domainsByGeo);
    const domainMappings = sourceMappings.map(normalizeDomainMapping)
        .filter((mapping, index, list) => list.findIndex((item) => item.geo === mapping.geo) === index);
    const domainsByGeo = Object.fromEntries(domainMappings.map((mapping) => [
        mapping.geo,
        [mapping.domainId],
    ]));
    return {
        pixels,
        defaultPixelId: ids.has(String(value.defaultPixelId ?? ""))
            ? String(value.defaultPixelId)
            : (pixels[0]?.id ?? ""),
        domainMappings,
        domainsByGeo,
    };
}


export default class KeitaroCampaignSettingsManager {
    #operation = Promise.resolve();

    constructor({ settingsFile = "./data/keitaro-campaign-settings.json" } = {}) {
        this.settingsFile = settingsFile;
    }

    get() {
        return this.#enqueue(async () => structuredClone(await this.#read()));
    }

    save(value) {
        return this.#enqueue(async () => {
            const store = normalizeStore(value);
            await this.#write(store);
            return structuredClone(store);
        });
    }

    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }

    async #read() {
        try {
            return normalizeStore(JSON.parse(await readFile(this.settingsFile, "utf8")));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            const store = normalizeStore();
            await this.#write(store);
            return store;
        }
    }

    async #write(store) {
        await mkdir(path.dirname(this.settingsFile), { recursive: true });
        const temporary = `${this.settingsFile}.tmp`;
        await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        await rename(temporary, this.settingsFile);
    }
}
