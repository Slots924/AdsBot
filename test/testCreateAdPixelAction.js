import assert from "node:assert/strict";

import createAdPixel, {
    createAdPixelStatuses,
} from "../facebook/api-actions/ads-manager/createAdPixel.js";


// Створює page-заглушку та зберігає параметри browser-запиту.
function createPage(response) {
    const calls = [];

    return {
        calls,
        async evaluate(_callback, argumentsObject) {
            calls.push(argumentsObject);
            return response;
        },
    };
}


const page = createPage({
    ok: true,
    statusCode: 200,
    body: JSON.stringify({ id: "pixel-id" }),
});
const result = await createAdPixel({
    page,
    accessToken: "test-access-token",
    adAccountId: "123456",
    name: "Test Pixel",
});

assert.equal(result.success, true);
assert.equal(result.status, createAdPixelStatuses.CREATED);
assert.deepEqual(result.data, {
    id: "pixel-id",
    name: "Test Pixel",
    adAccountId: "act_123456",
});
assert.equal(page.calls[0].accountId, "act_123456");
assert.equal(page.calls[0].pixelName, "Test Pixel");
assert.equal(page.calls[0].token, "test-access-token");

const graphErrorResult = await createAdPixel({
    page: createPage({
        ok: false,
        statusCode: 400,
        body: JSON.stringify({
            error: { message: "Invalid name", code: 100, type: "OAuthException" },
        }),
    }),
    accessToken: "test-access-token",
    adAccountId: "act_123456",
    name: "Test Pixel",
});

assert.equal(graphErrorResult.success, false);
assert.equal(graphErrorResult.status, createAdPixelStatuses.GRAPH_API_ERROR);
assert.equal(graphErrorResult.graphError.code, 100);

const invalidResult = await createAdPixel({
    page: createPage({}),
    accessToken: "",
    adAccountId: "invalid",
    name: "",
});

assert.equal(invalidResult.success, false);
assert.equal(invalidResult.status, createAdPixelStatuses.INVALID_INPUT);

console.log("Перевірка Facebook action створення Meta Pixel пройшла успішно");
