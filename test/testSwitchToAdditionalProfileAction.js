import assert from "node:assert/strict";

import switchToAdditionalProfile, {
    switchToAdditionalProfileStatuses,
} from "../facebook/api-actions/pages/switchToAdditionalProfile.js";


const commonPayload = {
    av: "61593928954145",
    __user: "61593928954145",
    __a: "1",
    fb_dtsg: "token",
    jazoest: "25681",
    lsd: "lsd-token",
    __comet_req: "15",
    __spin_r: "1048592354",
    __spin_b: "trunk",
    __spin_t: "1790506573",
    __crn: "comet.fbweb.CometHomeRoute",
};


// Створює заглушку сторінки та зберігає параметри fetch-виклику action.
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
    body: "",
});
const result = await switchToAdditionalProfile({
    page,
    commonPayload,
    additionalProfileId: "61594979545862",
});

assert.equal(result.success, true);
assert.equal(
    result.status,
    switchToAdditionalProfileStatuses.SWITCH_REQUEST_ACCEPTED
);
assert.equal(result.additionalProfileId, "61594979545862");
assert.equal(result.data, null);

const requestParameters = new URLSearchParams(page.calls[0].requestBody);
assert.equal(
    requestParameters.get("fb_api_req_friendly_name"),
    "CometProfileSwitchMutation"
);
assert.equal(requestParameters.get("doc_id"), "29569331136046912");
assert.deepEqual(JSON.parse(requestParameters.get("variables")), {
    profile_id: "61594979545862",
});

const invalidResult = await switchToAdditionalProfile({
    page: createPage({ ok: true, statusCode: 200, body: "" }),
    commonPayload,
    additionalProfileId: "",
});

assert.equal(invalidResult.success, false);
assert.equal(
    invalidResult.status,
    switchToAdditionalProfileStatuses.INVALID_INPUT
);
assert.match(invalidResult.error, /additionalProfileId/);

console.log("Перевірка Facebook action перемикання additional profile пройшла успішно");
