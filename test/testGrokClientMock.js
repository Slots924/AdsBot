import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import GrokClient from "../services/llm/grok/GrokClient.js";
import loadGrokSystemPrompt
    from "../services/llm/grok/loadGrokSystemPrompt.js";


const apiKey = "TEST_XAI_API_KEY";
const apiUrl = "https://api.x.ai/v1/responses";
const model = "grok-test-model";
let capturedRequest;

const successfulHttpClient = {
    async request(config) {
        capturedRequest = config;

        return {
            data: {
                id: "response-123",
                model: "grok-test-model-001",
                output: [{
                    type: "message",
                    content: [
                        { type: "output_text", text: "Перша частина" },
                        { type: "output_text", text: "Друга частина" },
                    ],
                }],
                usage: {
                    input_tokens: 10,
                    output_tokens: 5,
                    total_tokens: 15,
                },
            },
        };
    },
};

const grokClient = new GrokClient({
    apiKey,
    apiUrl,
    model,
    httpClient: successfulHttpClient,
});

const result = await grokClient.generateText({
    systemPrompt: "Системна інструкція",
    prompt: "Запит користувача",
});

assert.equal(result.text, "Перша частина\nДруга частина");
assert.equal(result.responseId, "response-123");
assert.equal(result.model, "grok-test-model-001");
assert.equal(result.usage.total_tokens, 15);
assert.equal(capturedRequest.method, "post");
assert.equal(capturedRequest.url, apiUrl);
assert.equal(
    capturedRequest.headers.Authorization,
    `Bearer ${apiKey}`
);
assert.equal(capturedRequest.data.model, model);
assert.deepEqual(capturedRequest.data.input, [
    {
        role: "system",
        content: "Системна інструкція",
    },
    {
        role: "user",
        content: "Запит користувача",
    },
]);

assert.throws(
    () => new GrokClient({
        apiKey: "",
        apiUrl,
        model,
        httpClient: successfulHttpClient,
    }),
    { code: "GROK_CONFIG_ERROR" }
);

assert.throws(
    () => new GrokClient({
        apiKey,
        apiUrl: "",
        model,
        httpClient: successfulHttpClient,
    }),
    { code: "GROK_CONFIG_ERROR" }
);

assert.throws(
    () => new GrokClient({
        apiKey,
        apiUrl,
        model: "",
        httpClient: successfulHttpClient,
    }),
    { code: "GROK_CONFIG_ERROR" }
);

await assert.rejects(
    grokClient.generateText({
        systemPrompt: "",
        prompt: "Запит",
    }),
    { code: "GROK_VALIDATION_ERROR" }
);

await assert.rejects(
    grokClient.generateText({
        systemPrompt: "Система",
        prompt: "",
    }),
    { code: "GROK_VALIDATION_ERROR" }
);

const failingClient = new GrokClient({
    apiKey,
    apiUrl,
    model,
    httpClient: {
        async request() {
            const error = new Error("Request failed");
            error.response = {
                status: 429,
                data: {
                    error: {
                        message: `Rate limit for ${apiKey}`,
                        code: "rate_limit_exceeded",
                        type: "rate_limit_error",
                    },
                },
            };
            throw error;
        },
    },
});

await assert.rejects(
    async () => {
        try {
            await failingClient.generateText({
                systemPrompt: "Система",
                prompt: "Запит",
            });
        } catch (error) {
            assert.equal(error.code, "GROK_API_ERROR");
            assert.equal(error.httpStatus, 429);
            assert(!error.message.includes(apiKey));
            throw error;
        }
    },
    { code: "GROK_API_ERROR" }
);

const emptyResponseClient = new GrokClient({
    apiKey,
    apiUrl,
    model,
    httpClient: {
        async request() {
            return {
                data: {
                    id: "empty-response",
                    output: [],
                },
            };
        },
    },
});

await assert.rejects(
    emptyResponseClient.generateText({
        systemPrompt: "Система",
        prompt: "Запит",
    }),
    { code: "GROK_EMPTY_RESPONSE" }
);

const systemPrompt = await loadGrokSystemPrompt();
assert(systemPrompt.length > 0);

const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-grok-test-")
);
const emptyPromptPath = path.join(temporaryDirectory, "empty-system.txt");

try {
    await writeFile(emptyPromptPath, "   \n", "utf8");
    await assert.rejects(
        loadGrokSystemPrompt(emptyPromptPath),
        { code: "GROK_CONFIG_ERROR" }
    );
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Mock-перевірка GrokClient пройшла успішно");
