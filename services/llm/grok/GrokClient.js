import axios from "axios";


function createGrokError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}


function requireConfigValue(value, name) {
    const normalizedValue = String(value ?? "").trim();

    if (!normalizedValue) {
        throw createGrokError(
            `Не заповнено змінну ${name}`,
            "GROK_CONFIG_ERROR"
        );
    }

    return normalizedValue;
}


function normalizeApiUrl(value) {
    const apiUrl = requireConfigValue(value, "XAI_API_URL");
    let parsedUrl;

    try {
        parsedUrl = new URL(apiUrl);
    } catch {
        throw createGrokError(
            "XAI_API_URL містить некоректну URL-адресу",
            "GROK_CONFIG_ERROR"
        );
    }

    if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
        throw createGrokError(
            "XAI_API_URL має використовувати HTTP або HTTPS",
            "GROK_CONFIG_ERROR"
        );
    }

    return apiUrl;
}


function extractOutputText(data) {
    if (!Array.isArray(data?.output)) {
        return "";
    }

    return data.output
        .flatMap((item) =>
            Array.isArray(item?.content) ? item.content : []
        )
        .filter(
            (item) =>
                item?.type === "output_text"
                && typeof item.text === "string"
                && item.text.trim()
        )
        .map((item) => item.text.trim())
        .join("\n")
        .trim();
}


function normalizePrompt(value, label) {
    const normalizedValue = String(value ?? "").trim();

    if (!normalizedValue) {
        throw createGrokError(
            `${label} не може бути порожнім`,
            "GROK_VALIDATION_ERROR"
        );
    }

    return normalizedValue;
}


function normalizeJsonSchema(schema, schemaName) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        throw createGrokError(
            "JSON schema має бути об'єктом",
            "GROK_VALIDATION_ERROR"
        );
    }

    const normalizedSchemaName = String(schemaName ?? "").trim();

    if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalizedSchemaName)) {
        throw createGrokError(
            "Назва JSON schema має містити лише латинські літери, цифри, _ або -",
            "GROK_VALIDATION_ERROR"
        );
    }

    return {
        schema,
        schemaName: normalizedSchemaName,
    };
}


export default class GrokClient {
    #apiKey;


    constructor({
        apiKey = process.env.XAI_API_KEY,
        apiUrl = process.env.XAI_API_URL,
        model = process.env.XAI_MODEL,
        timeout = 300000,
        httpClient = axios,
    } = {}) {
        if (!Number.isFinite(timeout) || timeout <= 0) {
            throw createGrokError(
                "Timeout Grok має бути додатним числом",
                "GROK_CONFIG_ERROR"
            );
        }

        if (typeof httpClient?.request !== "function") {
            throw createGrokError(
                "HTTP-клієнт Grok не містить метод request",
                "GROK_CONFIG_ERROR"
            );
        }

        this.#apiKey = requireConfigValue(apiKey, "XAI_API_KEY");
        this.apiUrl = normalizeApiUrl(apiUrl);
        this.model = requireConfigValue(model, "XAI_MODEL");
        this.timeout = timeout;
        this.httpClient = httpClient;
    }


    /**
     * Надсилає system і user prompts до Grok та повертає текст із метаданими.
     * @param {object} options Дані запиту.
     * @param {string} options.systemPrompt Системний prompt.
     * @param {string} options.prompt Запит користувача.
     * @param {boolean} [options.search=false] Якщо true — увімкнути web_search tool (доступ до інтернету) для запиту.
     * @returns {Promise<{text: string, responseId: string|null, model: string, usage: object|null}>}
     * @throws {Error} GROK_VALIDATION_ERROR, GROK_API_ERROR або GROK_EMPTY_RESPONSE.
     */
    async generateText({ systemPrompt, prompt, search = false } = {}) {
        const response = await this.#request({ systemPrompt, prompt, search });

        return {
            text: response.text,
            responseId: response.data?.id ?? null,
            model: response.data?.model ?? this.model,
            usage: response.data?.usage ?? null,
        };
    }


    /**
     * Надсилає запит до Grok і повертає JSON, який відповідає заданій схемі.
     * @param {object} options Дані запиту.
     * @param {string} options.systemPrompt Системний prompt.
     * @param {string} options.prompt Запит користувача.
     * @param {object} options.schema JSON schema для відповіді.
     * @param {string} [options.schemaName="response"] Назва JSON schema.
     * @param {boolean} [options.search=false] Якщо true — увімкнути web_search tool (доступ до інтернету) для запиту.
     * @returns {Promise<{data: object, responseId: string|null, model: string, usage: object|null}>}
     * @throws {Error} GROK_VALIDATION_ERROR, GROK_API_ERROR, GROK_EMPTY_RESPONSE або GROK_INVALID_JSON_RESPONSE.
     */
    async generateJson({
        systemPrompt,
        prompt,
        schema,
        schemaName = "response",
        search = false,
    } = {}) {
        const normalizedSchema = normalizeJsonSchema(schema, schemaName);
        const response = await this.#request({
            systemPrompt,
            prompt,
            text: {
                format: {
                    type: "json_schema",
                    name: normalizedSchema.schemaName,
                    schema: normalizedSchema.schema,
                    strict: true,
                },
            },
            search,
        });
        let data;

        try {
            let jsonText = response.text.trim();
            // Remove markdown code blocks if present
            jsonText = jsonText.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
            // Find the outermost JSON object or array
            const firstBrace = jsonText.search(/[\{\[]/);
            if (firstBrace > 0) {
                jsonText = jsonText.substring(firstBrace);
            }
            const lastBrace = jsonText.lastIndexOf(jsonText.startsWith('{') ? '}' : ']') + 1;
            if (lastBrace > 0 && lastBrace < jsonText.length) {
                jsonText = jsonText.substring(0, lastBrace);
            }
            data = JSON.parse(jsonText);
        } catch {
            throw createGrokError(
                "Grok API повернув невалідний JSON",
                "GROK_INVALID_JSON_RESPONSE"
            );
        }

        return {
            data,
            responseId: response.data?.id ?? null,
            model: response.data?.model ?? this.model,
            usage: response.data?.usage ?? null,
        };
    }


    async #request({ systemPrompt, prompt, text, search = false }) {
        const normalizedSystemPrompt = normalizePrompt(
            systemPrompt,
            "System prompt"
        );
        const normalizedPrompt = normalizePrompt(prompt, "User prompt");

        let response;

        try {
            const requestData = {
                model: this.model,
                input: [
                    {
                        role: "system",
                        content: normalizedSystemPrompt,
                    },
                    {
                        role: "user",
                        content: normalizedPrompt,
                    },
                ],
                ...(text ? { text } : {}),
            };

            if (search) {
                requestData.tools = [
                    {
                        type: "web_search",
                    },
                ];
            }

            response = await this.httpClient.request({
                method: "post",
                url: this.apiUrl,
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${this.#apiKey}`,
                    "Content-Type": "application/json",
                },
                data: requestData,
                timeout: this.timeout,
            });
        } catch (error) {
            const apiMessage = String(
                error?.response?.data?.error?.message ?? ""
            );
            const safeApiMessage = apiMessage
                ? apiMessage.replaceAll(this.#apiKey, "[REDACTED]")
                : "Не вдалося виконати запит до Grok API";

            throw createGrokError(
                safeApiMessage,
                "GROK_API_ERROR",
                {
                    httpStatus: error?.response?.status ?? null,
                    apiCode: error?.response?.data?.error?.code ?? null,
                    apiType: error?.response?.data?.error?.type ?? null,
                }
            );
        }

        const outputText = extractOutputText(response.data);

        if (!outputText) {
            throw createGrokError(
                "Grok API не повернув текстової відповіді",
                "GROK_EMPTY_RESPONSE"
            );
        }

        return {
            data: response.data,
            text: outputText,
        };
    }
}
