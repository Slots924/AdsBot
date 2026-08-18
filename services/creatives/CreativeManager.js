import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import GrokClient from "../llm/grok/GrokClient.js";
import loadGrokSystemPrompt
    from "../llm/grok/loadGrokSystemPrompt.js";


const COMMENT_FIELDS = [
    "gender",
    "id",
    "is_author",
    "parent_id",
    "profile_key",
    "should_write",
    "text",
];

const CREATIVE_FIELDS = ["comments", "creative"];

const CREATIVE_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["creative", "comments"],
    properties: {
        creative: {
            type: "string",
        },
        comments: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "id",
                    "parent_id",
                    "text",
                    "gender",
                    "profile_key",
                    "is_author",
                    "should_write",
                ],
                properties: {
                    id: {
                        type: "string",
                        minLength: 1,
                    },
                    parent_id: {
                        anyOf: [
                            { type: "string", minLength: 1 },
                            { type: "null" },
                        ],
                    },
                    text: {
                        type: "string",
                    },
                    gender: {
                        anyOf: [
                            { type: "string", enum: ["male", "female"] },
                            { type: "null" },
                        ],
                    },
                    profile_key: {
                        anyOf: [
                            { type: "string", minLength: 1 },
                            { type: "null" },
                        ],
                    },
                    is_author: {
                        type: "boolean",
                    },
                    should_write: {
                        type: "boolean",
                    },
                },
            },
        },
    },
};


function createCreativeError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function isPlainObject(value) {
    return Boolean(
        value
        && typeof value === "object"
        && !Array.isArray(value)
    );
}


function hasExactFields(value, fields) {
    return isPlainObject(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(fields);
}


function normalizeGeo(geo) {
    const normalizedGeo = String(geo ?? "").trim().toUpperCase();

    if (!/^[A-Z]{2}$/.test(normalizedGeo)) {
        throw createCreativeError(
            "Geo має бути дволітерним кодом країни, наприклад US або UA",
            "CREATIVE_VALIDATION_ERROR"
        );
    }

    return normalizedGeo;
}


function normalizeName(name) {
    const normalizedName = String(name ?? "").trim();

    if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalizedName)) {
        throw createCreativeError(
            "Назва креативу має містити лише латинські літери, цифри, _ або -",
            "CREATIVE_VALIDATION_ERROR"
        );
    }

    return normalizedName;
}


function isNullableNonEmptyString(value) {
    return value === null
        || (typeof value === "string" && value.length > 0);
}


function isValidComment(comment) {
    return hasExactFields(comment, COMMENT_FIELDS)
        && typeof comment.id === "string"
        && comment.id.length > 0
        && isNullableNonEmptyString(comment.parent_id)
        && typeof comment.text === "string"
        && ["male", "female", null].includes(comment.gender)
        && isNullableNonEmptyString(comment.profile_key)
        && typeof comment.is_author === "boolean"
        && typeof comment.should_write === "boolean";
}


function validateCreative(value, code, message) {
    const valid = hasExactFields(value, CREATIVE_FIELDS)
        && typeof value.creative === "string"
        && Array.isArray(value.comments)
        && value.comments.every(isValidComment);

    if (!valid) {
        throw createCreativeError(message, code);
    }

    return value;
}


export default class CreativeManager {
    #countriesPromise;
    #operations = new Map();


    constructor({
        grokClient,
        countriesFile = "./data/countries.json",
        creativesDirectory = "./data/creatives",
        originalsDirectory,
        systemPromptFile = "./data/prompts/grok/format-creative-to-json.txt",
    } = {}) {
        this.grokClient = grokClient ?? new GrokClient();

        if (typeof this.grokClient?.generateJson !== "function") {
            throw createCreativeError(
                "Grok-клієнт не містить методу generateJson",
                "CREATIVE_VALIDATION_ERROR"
            );
        }

        this.countriesFile = path.resolve(countriesFile);
        this.creativesDirectory = path.resolve(creativesDirectory);
        this.originalsDirectory = path.resolve(
            originalsDirectory
                ?? path.join(this.creativesDirectory, "originals")
        );
        this.systemPromptFile = path.resolve(systemPromptFile);
    }


    /**
     * Повертає готовий креатив або створює його через Grok, якщо файла немає.
     * @param {string} geo Дволітерний код країни.
     * @param {string} name Коротка назва креативу.
     * @returns {Promise<{creative: string, comments: object[]}>}
     * @throws {Error} CREATIVE_VALIDATION_ERROR, CREATIVE_COUNTRY_NOT_FOUND, CREATIVE_ORIGINAL_NOT_FOUND, CREATIVE_INVALID_FILE, CREATIVE_INVALID_RESPONSE або CREATIVE_FILE_ERROR.
     */
    async getCreative(geo, name) {
        const context = await this.#resolveCreative(geo, name);

        return this.#withLock(context.key, async () => {
            const savedCreative = await this.#readSavedCreative(
                context.targetFile
            );

            if (savedCreative) {
                return savedCreative;
            }

            return this.#createCreative(context);
        });
    }


    /**
     * Створює креатив через Grok і перезаписує готовий файл.
     * @param {string} geo Дволітерний код країни.
     * @param {string} name Коротка назва креативу.
     * @returns {Promise<{creative: string, comments: object[]}>}
     * @throws {Error} CREATIVE_VALIDATION_ERROR, CREATIVE_COUNTRY_NOT_FOUND, CREATIVE_ORIGINAL_NOT_FOUND, CREATIVE_INVALID_RESPONSE або CREATIVE_FILE_ERROR.
     */
    async createCreative(geo, name) {
        const context = await this.#resolveCreative(geo, name);

        return this.#withLock(
            context.key,
            () => this.#createCreative(context)
        );
    }


    async #resolveCreative(geo, name) {
        const normalizedGeo = normalizeGeo(geo);
        const normalizedName = normalizeName(name);
        const countries = await this.#loadCountries();
        const countryName = countries[normalizedGeo];

        if (!countryName) {
            throw createCreativeError(
                `Країни з кодом ${normalizedGeo} немає у списку`,
                "CREATIVE_COUNTRY_NOT_FOUND",
                { geo: normalizedGeo }
            );
        }

        return {
            geo: normalizedGeo,
            name: normalizedName,
            countryName,
            key: `${normalizedGeo}:${normalizedName}`,
            targetFile: path.join(
                this.creativesDirectory,
                `${normalizedGeo} ${normalizedName}.json`
            ),
            originalFile: path.join(
                this.originalsDirectory,
                `${normalizedName}.txt`
            ),
        };
    }


    async #loadCountries() {
        if (!this.#countriesPromise) {
            this.#countriesPromise = this.#readCountries();
        }

        return this.#countriesPromise;
    }


    async #readCountries() {
        let content;
        let countries;

        try {
            content = await readFile(this.countriesFile, "utf8");
            countries = JSON.parse(content);
        } catch {
            throw createCreativeError(
                "Не вдалося прочитати список країн",
                "CREATIVE_FILE_ERROR"
            );
        }

        const valid = isPlainObject(countries)
            && Object.entries(countries).every(
                ([code, countryName]) =>
                    /^[A-Z]{2}$/.test(code)
                    && typeof countryName === "string"
                    && countryName.trim()
            );

        if (!valid) {
            throw createCreativeError(
                "Файл зі списком країн має неправильний формат",
                "CREATIVE_FILE_ERROR"
            );
        }

        return countries;
    }


    async #readSavedCreative(targetFile) {
        let content;

        try {
            content = await readFile(targetFile, "utf8");
        } catch (error) {
            if (error?.code === "ENOENT") {
                return null;
            }

            throw createCreativeError(
                "Не вдалося прочитати готовий креатив",
                "CREATIVE_FILE_ERROR"
            );
        }

        let creative;

        try {
            creative = JSON.parse(content);
        } catch {
            throw createCreativeError(
                "Готовий файл креативу містить невалідний JSON",
                "CREATIVE_INVALID_FILE"
            );
        }

        return validateCreative(
            creative,
            "CREATIVE_INVALID_FILE",
            "Готовий файл креативу має неправильну структуру"
        );
    }


    async #createCreative(context) {
        const original = await this.#readOriginal(context.originalFile);
        const systemPrompt = await loadGrokSystemPrompt(
            this.systemPromptFile
        );
        let result;

        console.log(
            `Генеруємо креатив ${context.geo} ${context.name} через Grok. Це може зайняти декілька хвилин...`
        );

        try {
            result = await this.grokClient.generateJson({
                systemPrompt,
                prompt: `Адаптуй креатив під країну ${context.countryName} (${context.geo}).\n\n${original}`,
                schema: CREATIVE_JSON_SCHEMA,
                schemaName: "creative",
            });
        } catch (error) {
            if (error?.code === "GROK_INVALID_JSON_RESPONSE") {
                throw createCreativeError(
                    "Grok повернув невалідний JSON креативу",
                    "CREATIVE_INVALID_RESPONSE"
                );
            }

            throw error;
        }

        const creative = validateCreative(
            result?.data,
            "CREATIVE_INVALID_RESPONSE",
            "Відповідь Grok має неправильну структуру креативу"
        );

        try {
            await mkdir(this.creativesDirectory, { recursive: true });
            await writeFile(
                context.targetFile,
                `${JSON.stringify(creative, null, 2)}\n`,
                "utf8"
            );
        } catch {
            throw createCreativeError(
                "Не вдалося зберегти готовий креатив",
                "CREATIVE_FILE_ERROR"
            );
        }

        return creative;
    }


    async #readOriginal(originalFile) {
        let original;

        try {
            original = await readFile(originalFile, "utf8");
        } catch (error) {
            if (error?.code === "ENOENT") {
                throw createCreativeError(
                    "Оригінал креативу не знайдено",
                    "CREATIVE_ORIGINAL_NOT_FOUND"
                );
            }

            throw createCreativeError(
                "Не вдалося прочитати оригінал креативу",
                "CREATIVE_FILE_ERROR"
            );
        }

        const normalizedOriginal = original.trim();

        if (!normalizedOriginal) {
            throw createCreativeError(
                "Оригінал креативу порожній",
                "CREATIVE_ORIGINAL_NOT_FOUND"
            );
        }

        return normalizedOriginal;
    }


    #withLock(key, operation) {
        const currentOperation = this.#operations.get(key);

        if (currentOperation) {
            return currentOperation;
        }

        const newOperation = Promise.resolve()
            .then(operation)
            .finally(() => {
                if (this.#operations.get(key) === newOperation) {
                    this.#operations.delete(key);
                }
            });

        this.#operations.set(key, newOperation);
        return newOperation;
    }
}
