import { withFacebookRuntime, testAccessToken } from "./helpers/facebookRuntimePage.js";
import assert from "node:assert/strict";

import getAdPixels, {
    getAdPixelsStatuses,
} from "../facebook/api-actions/ads-manager/getAdPixels.js";


// Створює page-заглушку та зберігає параметри browser-запиту.
function createPage(response) {
    const calls = [];

    return withFacebookRuntime({
        calls,
        async evaluate(_callback, argumentsObject) {
            calls.push(argumentsObject);
            return response;
        },
    }, { surface: "adsManager" });
}


const page = createPage({
    ok: true,
    statusCode: 200,
    pixels: [
        { id: "pixel-1", name: "Pixel One", access_token: "ignored" },
        { id: "pixel-2", name: "Pixel Two" },
    ],
});
const result = await getAdPixels({
    page,
    adAccountId: "123456",
});

assert.equal(result.success, true);
assert.equal(result.status, getAdPixelsStatuses.PIXELS_FETCHED);
assert.deepEqual(result.data, [
    { id: "pixel-1", name: "Pixel One" },
    { id: "pixel-2", name: "Pixel Two" },
]);
assert.equal(page.calls[0].accountId, "act_123456");
assert.equal(page.calls[0].token, testAccessToken);
assert.equal(JSON.stringify(result).includes("access_token"), false);

const graphErrorResult = await getAdPixels({
    page: createPage({
        ok: false,
        statusCode: 400,
        graphError: { code: 190, subcode: 463, type: "OAuthException" },
    }),
    adAccountId: "act_123456",
});

assert.equal(graphErrorResult.success, false);
assert.equal(graphErrorResult.status, getAdPixelsStatuses.GRAPH_API_ERROR);
assert.equal(graphErrorResult.graphError.code, 190);

const invalidResult = await getAdPixels({
    page: createPage({}),
    adAccountId: "invalid",
});

assert.equal(invalidResult.success, false);
assert.equal(invalidResult.status, getAdPixelsStatuses.INVALID_INPUT);

console.log("Перевірка Facebook action читання Meta Pixel пройшла успішно");
