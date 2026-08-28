import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 2;

function createError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function clone(value) {
    return structuredClone(value);
}

export function emptyStreamDraft() {
    return {
        type: "regular",
        name: "",
        comments: "",
        state: "active",
        schema: "landings",
        collect_clicks: false,
        filter_or: false,
        weight: 100,
        offer_selection: "before_click",
        action_type: "http",
        action_payload: "",
        filters: [],
        landings: [],
        offers: [],
        triggers: [],
    };
}

export function stream423Template() {
    return {
        name: "White (копія потоку 423)",
        sourceStreamId: 423,
        stream: {
            ...emptyStreamDraft(),
            name: "White",
            filter_or: true,
            filters: [
                { name: "os", mode: "accept", payload: ["Arch Linux", "GNU/Linux", "VectorLinux"] },
                { name: "bot", mode: "accept", payload: null },
                { name: "country", mode: "reject", payload: ["JP"] },
                { name: "proxy", mode: "accept", payload: null },
            ],
            landings: [{
                landing_id: 68,
                name: "White [JP]",
                group: "JP",
                state: "active",
                share: 100,
            }],
        },
    };
}

function normalizeFilter(filter = {}) {
    const payload = filter.payload;
    return {
        ...clone(filter),
        name: String(filter.name ?? "country").trim() || "country",
        mode: filter.mode === "reject" ? "reject" : "accept",
        payload: Array.isArray(payload)
            ? payload.map((item) => String(item ?? "").trim()).filter(Boolean)
            : payload == null || payload === ""
                ? null
                : clone(payload),
    };
}

function normalizeAsset(item = {}, idKey) {
    const id = Number(item[idKey] ?? item.id);
    return {
        ...clone(item),
        [idKey]: Number.isInteger(id) && id > 0 ? id : 0,
        name: String(item.name ?? "").trim(),
        state: item.state === "disabled" ? "disabled" : "active",
        share: Number.isFinite(Number(item.share)) ? Number(item.share) : 100,
    };
}

function streamWithoutPlacement(source = {}) {
    const stream = clone(source ?? {});
    for (const key of ["id", "campaign_id", "campaignId", "position", "created_at", "updated_at", "is_monitoring", "monitoring_url"]) {
        delete stream[key];
    }
    return stream;
}

export function normalizeStreamDraft(input = {}) {
    const source = input.stream ?? input;
    const stream = {
        ...emptyStreamDraft(),
        ...streamWithoutPlacement(source),
        name: String(source.name ?? input.name ?? "").trim(),
        comments: String(source.comments ?? source.notes ?? ""),
        type: ["regular", "forced", "default"].includes(source.type)
            ? source.type
            : "regular",
        state: source.state === "disabled" ? "disabled" : "active",
        schema: String(source.schema ?? "landings"),
        collect_clicks: Boolean(source.collect_clicks),
        filter_or: Boolean(source.filter_or),
        weight: Number.isFinite(Number(source.weight)) ? Number(source.weight) : 100,
        offer_selection: String(source.offer_selection ?? "before_click"),
        action_type: String(source.action_type ?? "http"),
        action_payload: String(source.action_payload ?? ""),
        filters: Array.isArray(source.filters) ? source.filters.map(normalizeFilter) : [],
        landings: Array.isArray(source.landings)
            ? source.landings.map((item) => normalizeAsset(item, "landing_id"))
            : [],
        offers: Array.isArray(source.offers)
            ? source.offers.map((item) => normalizeAsset(item, "offer_id"))
            : [],
        triggers: Array.isArray(source.triggers) ? clone(source.triggers) : [],
    };
    const name = String(input.name ?? stream.name).trim();
    if (!name) {
        throw createError("Назва шаблону порожня", "STREAM_TEMPLATE_VALIDATION");
    }
    return {
        name,
        sourceStreamId: Number(input.sourceStreamId) || null,
        stream,
    };
}

export default class KeitaroStreamTemplateManager {
    #operation = Promise.resolve();

    constructor({ templatesFile = "./data/keitaro-stream-templates.json" } = {}) {
        this.templatesFile = templatesFile;
    }

    list() {
        return this.#enqueue(async () => clone((await this.#readStore()).templates));
    }

    get(id) {
        return this.#enqueue(async () => {
            const template = (await this.#readStore()).templates
                .find((item) => item.id === Number(id));
            if (!template) {
                throw createError(`Шаблон потоку ${id} не знайдено`, "STREAM_TEMPLATE_NOT_FOUND");
            }
            return clone(template);
        });
    }

    create(input) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const now = new Date().toISOString();
            const template = {
                id: store.nextId,
                ...normalizeStreamDraft(input),
                createdAt: now,
                updatedAt: now,
            };
            store.nextId += 1;
            store.templates.push(template);
            await this.#writeStore(store);
            return clone(template);
        });
    }

    update(id, input) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const index = store.templates.findIndex((item) => item.id === Number(id));
            if (index < 0) {
                throw createError(`Шаблон потоку ${id} не знайдено`, "STREAM_TEMPLATE_NOT_FOUND");
            }
            store.templates[index] = {
                ...store.templates[index],
                ...normalizeStreamDraft(input),
                id: store.templates[index].id,
                createdAt: store.templates[index].createdAt,
                updatedAt: new Date().toISOString(),
            };
            await this.#writeStore(store);
            return clone(store.templates[index]);
        });
    }

    duplicate(id) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const source = store.templates.find((item) => item.id === Number(id));
            if (!source) {
                throw createError(`Шаблон потоку ${id} не знайдено`, "STREAM_TEMPLATE_NOT_FOUND");
            }
            const now = new Date().toISOString();
            const copy = {
                ...clone(source),
                id: store.nextId,
                name: `${source.name} — копія`,
                sourceStreamId: null,
                createdAt: now,
                updatedAt: now,
            };
            store.nextId += 1;
            store.templates.push(copy);
            await this.#writeStore(store);
            return clone(copy);
        });
    }

    delete(id) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const index = store.templates.findIndex((item) => item.id === Number(id));
            if (index < 0) {
                throw createError(`Шаблон потоку ${id} не знайдено`, "STREAM_TEMPLATE_NOT_FOUND");
            }
            const [deleted] = store.templates.splice(index, 1);
            await this.#writeStore(store);
            return clone(deleted);
        });
    }

    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }

    async #readStore() {
        try {
            const parsed = JSON.parse(await readFile(this.templatesFile, "utf8"));
            const templates = (Array.isArray(parsed?.templates) ? parsed.templates : [])
                .filter((item) => Number.isInteger(item?.id) && item.id > 0)
                .map((item) => ({
                    id: item.id,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    ...normalizeStreamDraft(item),
                }));
            const maxId = templates.reduce((max, item) => Math.max(max, item.id), 0);
            return {
                nextId: Math.max(Number(parsed?.nextId) || 1, maxId + 1),
                templates,
            };
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            const now = new Date().toISOString();
            const seeded = {
                id: 1,
                ...normalizeStreamDraft(stream423Template()),
                createdAt: now,
                updatedAt: now,
            };
            const store = { nextId: 2, templates: [seeded] };
            await this.#writeStore(store);
            return store;
        }
    }

    async #writeStore(store) {
        await mkdir(path.dirname(this.templatesFile), { recursive: true });
        const temporaryFile = `${this.templatesFile}.tmp`;
        await writeFile(temporaryFile, `${JSON.stringify({
            version: SCHEMA_VERSION,
            nextId: store.nextId,
            templates: store.templates,
        }, null, 2)}\n`, "utf8");
        await rename(temporaryFile, this.templatesFile);
    }
}
