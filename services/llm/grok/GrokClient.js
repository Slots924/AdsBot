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


export default class GrokClient {
    #apiKey;


    constructor({
        apiKey = process.env.XAI_API_KEY,
        apiUrl = process.env.XAI_API_URL,
        model = process.env.XAI_MODEL,
        timeout = 60000,
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
     * @returns {Promise<{text: string, responseId: string|null, model: string, usage: object|null}>}
     * @throws {Error} GROK_VALIDATION_ERROR, GROK_API_ERROR або GROK_EMPTY_RESPONSE.
     */
    async generateText({ systemPrompt, prompt } = {}) {
        const normalizedSystemPrompt = String(
            systemPrompt ?? ""
        ).trim();
        const normalizedPrompt = String(prompt ?? "").trim();

        if (!normalizedSystemPrompt) {
            throw createGrokError(
                "System prompt не може бути порожнім",
                "GROK_VALIDATION_ERROR"
            );
        }

        if (!normalizedPrompt) {
            throw createGrokError(
                "User prompt не може бути порожнім",
                "GROK_VALIDATION_ERROR"
            );
        }

        let response;

        try {
            response = await this.httpClient.request({
                method: "post",
                url: this.apiUrl,
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${this.#apiKey}`,
                    "Content-Type": "application/json",
                },
                data: {
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
                },
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

        const text = extractOutputText(response.data);

        if (!text) {
            throw createGrokError(
                "Grok API не повернув текстової відповіді",
                "GROK_EMPTY_RESPONSE"
            );
        }

        return {
            text,
            responseId: response.data?.id ?? null,
            model: response.data?.model ?? this.model,
            usage: response.data?.usage ?? null,
        };
    }
}
