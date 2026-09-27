import assert from "node:assert/strict";

import createFanPage, {
    createFanPageStatuses,
} from "../facebook/api-actions/pages/createFanPage.js";


const commonPayload = {
    av: "100",
    __user: "100",
    __a: "1",
    fb_dtsg: "token",
    jazoest: "22000",
    lsd: "lsd-token",
    __comet_req: "15",
    __spin_r: "1048590665",
    __spin_b: "trunk",
    __spin_t: "1790504120",
    __crn: "comet.fbweb.CometAdditionalProfilePlusCreationRoute",
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


const successResponse = (body) => ({
    ok: true,
    statusCode: 200,
    body: JSON.stringify(body),
});


const page = createPage(successResponse({
    data: {
        additional_profile_plus_create: {
            additional_profile: { id: "additional-profile-id" },
            page: { id: "page-id" },
            name_error: null,
            error_message: null,
        },
    },
}));
const successResult = await createFanPage({
    page,
    commonPayload,
    name: "Test Fan Page",
});

assert.equal(successResult.success, true);
assert.equal(successResult.status, createFanPageStatuses.CREATED);
assert.equal(successResult.pageId, "page-id");
assert.equal(successResult.additionalProfileId, "additional-profile-id");
assert.equal(
    successResult.data.data.additional_profile_plus_create.page.id,
    "page-id"
);

const requestParameters = new URLSearchParams(page.calls[0].requestBody);
assert.equal(
    requestParameters.get("fb_api_req_friendly_name"),
    "AdditionalProfilePlusCreationMutation"
);
assert.equal(requestParameters.get("doc_id"), "23863457623296585");
assert.equal(
    requestParameters.get("__crn"),
    "comet.fbweb.CometAdditionalProfilePlusCreationRoute"
);
assert.deepEqual(JSON.parse(requestParameters.get("variables")), {
    input: {
        bio: "",
        categories: ["802560142464893"],
        creation_source: "comet",
        name: "Test Fan Page",
        off_platform_creator_reachout_id: null,
        page_referrer: "profile_switcher_unified_creation",
        actor_id: "100",
        client_mutation_id: "1",
    },
});

const rejectedResult = await createFanPage({
    page: createPage(successResponse({
        data: {
            additional_profile_plus_create: {
                additional_profile: null,
                page: null,
                name_error: "Назва недоступна",
                error_message: null,
            },
        },
    })),
    commonPayload,
    name: "Already used",
});

assert.equal(rejectedResult.success, false);
assert.equal(rejectedResult.status, createFanPageStatuses.CREATION_REJECTED);
assert.equal(rejectedResult.error, "Назва недоступна");

const invalidResult = await createFanPage({
    page: createPage(successResponse({})),
    commonPayload,
    name: "",
});

assert.equal(invalidResult.success, false);
assert.equal(invalidResult.status, createFanPageStatuses.INVALID_INPUT);

console.log("Перевірка Facebook action створення Fan Page пройшла успішно");
