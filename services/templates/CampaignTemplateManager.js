import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


export const TEMPLATE_SCHEMA_VERSION = 3;
export const TEMPLATE_GENDERS = new Set(["any", "male", "female"]);
export const TEMPLATE_PLACEMENTS = Object.freeze({
    facebook: ["feed", "story", "reels"],
    instagram: ["stream", "story", "reels"],
});


function createTemplateError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function uniqueStrings(values = []) {
    return [...new Set(
        (Array.isArray(values) ? values : [])
            .map((value) => String(value ?? "").trim())
            .filter(Boolean)
    )];
}


function normalizeAge(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) ? number : fallback;
}


function normalizePlacements(input = {}) {
    const result = {};
    Object.entries(TEMPLATE_PLACEMENTS).forEach(([platform, allowed]) => {
        result[platform] = uniqueStrings(input?.[platform]).filter(
            (placement) => allowed.includes(placement)
        );
    });

    if (!result.facebook.length && !result.instagram.length) {
        result.facebook = ["feed"];
    }
    return result;
}


export function normalizeTemplateInput(input = {}) {
    const name = String(input.name ?? "").trim();
    const pixel = String(input.pixel ?? input.pixelId ?? "").trim();
    const gender = TEMPLATE_GENDERS.has(input.gender)
        ? input.gender
        : "any";
    const ageMin = normalizeAge(input.ageMin, 18);
    const ageMax = normalizeAge(input.ageMax, 65);

    if (!name) {
        throw createTemplateError(
            "Вкажіть назву шаблону",
            "TEMPLATE_NAME_REQUIRED"
        );
    }
    if (ageMin < 18 || ageMin > 65 || ageMax < 18 || ageMax > 65) {
        throw createTemplateError(
            "Вік має бути в діапазоні від 18 до 65+",
            "TEMPLATE_AGE_INVALID"
        );
    }
    if (ageMin > ageMax) {
        throw createTemplateError(
            "Мінімальний вік не може бути більшим за максимальний",
            "TEMPLATE_AGE_RANGE_INVALID"
        );
    }

    return {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        name,
        pixel,
        countryCodes: uniqueStrings(input.countryCodes)
            .map((code) => code.toUpperCase())
            .filter((code) => /^[A-Z]{2}$/.test(code)),
        gender,
        ageMin,
        ageMax,
        placements: normalizePlacements(input.placements),
        utm: String(input.utm ?? "").trim(),
        shareAdSetBudget: Boolean(input.shareAdSetBudget),
        disableCreativeEnhancements: true,
        dsaBeneficiary: String(input.dsaBeneficiary ?? "").trim(),
        dsaPayorSameAsBeneficiary:
            input.dsaPayorSameAsBeneficiary !== false,
        dsaPayor: input.dsaPayorSameAsBeneficiary === false
            ? String(input.dsaPayor ?? "").trim()
            : "",
    };
}


function normalizeStoredTemplate(template) {
    return {
        id: template.id,
        ...normalizeTemplateInput(template),
        createdAt: template.createdAt ?? new Date().toISOString(),
        updatedAt: template.updatedAt ?? template.createdAt
            ?? new Date().toISOString(),
    };
}


export default class CampaignTemplateManager {
    #operation = Promise.resolve();


    constructor({ templatesFile = "./data/campaign-templates.json" } = {}) {
        this.templatesFile = templatesFile;
    }


    async list() {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            if (store.migrated) {
                await this.#writeStore(store);
            }
            return store.templates.map((template) => structuredClone(template));
        });
    }


    async get(id) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const template = store.templates.find(
                (item) => item.id === Number(id)
            );
            if (!template) {
                throw createTemplateError(
                    `Шаблон ID ${id} не знайдено`,
                    "TEMPLATE_NOT_FOUND"
                );
            }
            return structuredClone(template);
        });
    }


    async create(input) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const now = new Date().toISOString();
            const template = {
                id: store.nextId,
                ...normalizeTemplateInput(input),
                createdAt: now,
                updatedAt: now,
            };
            store.nextId += 1;
            store.templates.push(template);
            await this.#writeStore(store);
            return structuredClone(template);
        });
    }


    async update(id, input) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const numericId = Number(id);
            const index = store.templates.findIndex(
                (template) => template.id === numericId
            );
            if (index === -1) {
                throw createTemplateError(
                    `Шаблон ID ${id} не знайдено`,
                    "TEMPLATE_NOT_FOUND"
                );
            }
            const template = {
                ...store.templates[index],
                ...normalizeTemplateInput(input),
                updatedAt: new Date().toISOString(),
            };
            store.templates[index] = template;
            await this.#writeStore(store);
            return structuredClone(template);
        });
    }


    async duplicate(id) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const source = store.templates.find(
                (template) => template.id === Number(id)
            );
            if (!source) {
                throw createTemplateError(
                    `Шаблон ID ${id} не знайдено`,
                    "TEMPLATE_NOT_FOUND"
                );
            }
            const now = new Date().toISOString();
            const copy = {
                ...structuredClone(source),
                id: store.nextId,
                createdAt: now,
                updatedAt: now,
            };
            store.nextId += 1;
            store.templates.push(copy);
            await this.#writeStore(store);
            return structuredClone(copy);
        });
    }


    async delete(id) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const index = store.templates.findIndex(
                (template) => template.id === Number(id)
            );
            if (index === -1) {
                throw createTemplateError(
                    `Шаблон ID ${id} не знайдено`,
                    "TEMPLATE_NOT_FOUND"
                );
            }
            const [deleted] = store.templates.splice(index, 1);
            await this.#writeStore(store);
            return structuredClone(deleted);
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
            const sourceTemplates = Array.isArray(parsed?.templates)
                ? parsed.templates.filter((template) => (
                    Number.isInteger(template?.id) && template.id > 0
                ))
                : [];
            const templates = sourceTemplates.map(normalizeStoredTemplate);
            const maxId = templates.reduce(
                (maximum, template) => Math.max(maximum, template.id),
                0
            );
            return {
                version: TEMPLATE_SCHEMA_VERSION,
                nextId: Math.max(Number(parsed?.nextId) || 1, maxId + 1),
                templates,
                migrated: Number(parsed?.version) !== TEMPLATE_SCHEMA_VERSION
                    || sourceTemplates.some(
                        (template) => template.schemaVersion !== TEMPLATE_SCHEMA_VERSION
                    ),
            };
        } catch (error) {
            if (error.code === "ENOENT") {
                return {
                    version: TEMPLATE_SCHEMA_VERSION,
                    nextId: 1,
                    templates: [],
                    migrated: false,
                };
            }
            throw error;
        }
    }


    async #writeStore(store) {
        await mkdir(path.dirname(this.templatesFile), { recursive: true });
        const temporaryFile = `${this.templatesFile}.tmp`;
        const persistedStore = {
            version: TEMPLATE_SCHEMA_VERSION,
            nextId: store.nextId,
            templates: store.templates,
        };
        await writeFile(
            temporaryFile,
            `${JSON.stringify(persistedStore, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.templatesFile);
    }
}
