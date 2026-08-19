import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


function createTemplateError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function normalizeInput(input = {}) {
    const name = String(input.name ?? "").trim();
    const pixel = String(input.pixel ?? "").trim();

    if (!name) {
        throw createTemplateError(
            "Вкажіть назву шаблону",
            "TEMPLATE_NAME_REQUIRED"
        );
    }

    return { name, pixel };
}


export default class CampaignTemplateManager {
    #operation = Promise.resolve();


    constructor({ templatesFile = "./data/campaign-templates.json" } = {}) {
        this.templatesFile = templatesFile;
    }


    async list() {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            return store.templates.map((template) => ({ ...template }));
        });
    }


    async create(input) {
        return this.#enqueue(async () => {
            const store = await this.#readStore();
            const now = new Date().toISOString();
            const template = {
                id: store.nextId,
                ...normalizeInput(input),
                createdAt: now,
                updatedAt: now,
            };

            store.nextId += 1;
            store.templates.push(template);
            await this.#writeStore(store);
            return { ...template };
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
                ...normalizeInput(input),
                updatedAt: new Date().toISOString(),
            };
            store.templates[index] = template;
            await this.#writeStore(store);
            return { ...template };
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
                id: store.nextId,
                name: source.name,
                pixel: source.pixel,
                createdAt: now,
                updatedAt: now,
            };
            store.nextId += 1;
            store.templates.push(copy);
            await this.#writeStore(store);
            return { ...copy };
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
            return { ...deleted };
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
                await readFile(this.templatesFile, "utf8")
            );
            const templates = Array.isArray(parsed?.templates)
                ? parsed.templates.filter((template) => (
                    Number.isInteger(template?.id) && template.id > 0
                ))
                : [];
            const maxId = templates.reduce(
                (maximum, template) => Math.max(maximum, template.id),
                0
            );

            return {
                version: 1,
                nextId: Math.max(Number(parsed?.nextId) || 1, maxId + 1),
                templates,
            };
        } catch (error) {
            if (error.code === "ENOENT") {
                return { version: 1, nextId: 1, templates: [] };
            }
            throw error;
        }
    }


    async #writeStore(store) {
        await mkdir(path.dirname(this.templatesFile), { recursive: true });
        const temporaryFile = `${this.templatesFile}.tmp`;
        await writeFile(
            temporaryFile,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.templatesFile);
    }
}
