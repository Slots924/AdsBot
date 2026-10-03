import assert from "node:assert/strict";
import inviteBusinessUser from "../facebook/api-actions/ads-manager/inviteBusinessUser.js";

const commonPayload = {
    av: "123", __user: "123", __a: "1", __comet_req: "11",
    fb_dtsg: "mock-dtsg", jazoest: "2000", lsd: "mock-lsd",
    __dyn: "не передавати", __bid: "999", variables: "не передавати", doc_id: "999",
};
const input = {
    commonPayload, businessId: "456", emails: ["person@example.test"],
    pageIds: ["789", "789"], adAccountIds: ["act_120252063622850734", "120252063622850734"],
};
const pendingResponse = {
    ok: true, statusCode: 200,
    body: 'for (;;);' + JSON.stringify({ data: { business_settings_invite_business_users: {
        business_role_requests: [{ id: "321", role_request_status: "PENDING", expiration_time: 2000 }],
    } } }),
};

// Виконує справжній браузерний callback із підміною лише HTTP-транспорту.
function createPage(response = pendingResponse) {
    const calls = [];
    return {
        calls,
        url: () => "https://business.facebook.com/latest/settings/business_users?business_id=456",
        async evaluate(callback, args) {
            if (!args) return "Europe/Kyiv";
            const previousFetch = globalThis.fetch;
            globalThis.fetch = async (endpoint, options) => {
                calls.push({ endpoint, ...options });
                if (response.requestError) {
                    const error = new Error("Помилка mock-транспорту");
                    if (response.requestError === "TIMEOUT") error.name = "AbortError";
                    throw error;
                }
                return { ...response, status: response.statusCode, text: async () => response.body };
            };
            try { return await callback(args); } finally { globalThis.fetch = previousFetch; }
        },
    };
}

const employeeWithFinance = ["926381894526285", "768085000593466", "416103972652535"];
const adminWithoutFinance = [
    "926381894526285", "603931664885191", "1327662214465567", "862159105082613",
    "6161001899617846786", "1633404653754086", "967306614466178",
    "2848818871965443", "245181923290198", "388517145453246",
];
const pageTasks = [
    "461340961883703", "2565488997052663", "556750461849806", "275298030109664",
    "696659004201852", "270956550540539", "794616964377599", "997951390947110",
    "967977242754531", "1370797498202499", "290727579301631",
];
const adTasks = ["864195700451909", "151821535410699", "610690166001223", "186595505260379"];
for (const [role, financeAccess, expectedTasks] of [
    ["EMPLOYEE", true, employeeWithFinance],
    ["EMPLOYEE", false, ["926381894526285"]],
    ["ADMIN", false, adminWithoutFinance],
    ["ADMIN", true, [...adminWithoutFinance, ...employeeWithFinance.slice(1)]],
]) {
    const page = createPage();
    const result = await inviteBusinessUser({ ...input, page, role, financeAccess });
    assert.equal(result.success, true);
    assert.equal(result.status, "PENDING");
    assert.deepEqual(result.data.requests, [{ id: "321", status: "PENDING", expirationTime: 2000 }]);
    assert.equal(page.calls.length, 1);
    const request = page.calls[0];
    assert.equal(request.endpoint, "/api/graphql/");
    assert.equal(request.credentials, "include");
    assert.equal(request.headers["x-fb-lsd"], "mock-lsd");
    const body = new URLSearchParams(request.body);
    assert.equal(body.get("__bid"), "456");
    assert.equal(body.get("doc_id"), "31295717360015609");
    assert.equal(body.get("fb_api_req_friendly_name"), "BizKitSettingsInvitePeopleModalMutation");
    assert.deepEqual([...body.keys()].sort(), [
        "av", "__user", "__a", "fb_dtsg", "jazoest", "lsd", "__comet_req", "__bid",
        "fb_api_caller_class", "server_timestamps", "fb_api_req_friendly_name", "doc_id", "variables",
    ].sort());
    const variables = JSON.parse(body.get("variables")).input;
    assert.deepEqual(variables.business_account_task_ids, expectedTasks);
    assert.deepEqual(variables.assets, [
        { asset_id: "789", permitted_task_ids: pageTasks },
        { asset_id: "120252063622850734", permitted_task_ids: adTasks },
    ]);
    assert.equal(variables.actor_id, "123");
    assert.equal(variables.business_id, "456");
    assert.deepEqual(variables.business_emails, ["person@example.test"]);
    assert.equal(variables.client_timezone_id, "Europe/Kyiv");
    assert.equal(variables.auto_assign_access, false);
}

const defaultPage = createPage();
assert.equal((await inviteBusinessUser({ ...input, page: defaultPage })).data.financeAccess, true);
for (const invalid of [
    { role: "OWNER" }, { financeAccess: "false" }, { businessId: 456 },
    { emails: [] }, { emails: ["bad-email"] }, { adAccountIds: [120252063622850734] },
    { pageIds: ["789"], adAccountIds: ["789"] },
    { commonPayload: { ...commonPayload, fb_dtsg: "" } },
]) {
    const page = createPage();
    assert.equal((await inviteBusinessUser({ ...input, ...invalid, page })).status, "INVALID_INPUT");
    assert.equal(page.calls.length, 0);
}
assert.equal((await inviteBusinessUser({ ...input, page: {
    ...createPage(), url: () => "https://www.facebook.com/",
} })).status, "INVALID_INPUT");
for (const [response, status] of [
    [{ requestError: "TIMEOUT" }, "REQUEST_TIMEOUT"],
    [{ requestError: "NETWORK" }, "REQUEST_FAILED"],
    [{ ok: false, statusCode: 403 }, "HTTP_ERROR"],
    [{ ok: true, body: "not-json" }, "PARSE_ERROR"],
    [{ ok: true, body: '{"errors":[{"message":"Denied"}]}' }, "GRAPHQL_ERROR"],
    [{ ok: true, body: '{"data":{}}' }, "INVITE_RESULT_UNEXPECTED"],
    [{ ok: true, body: '{"data":{"business_settings_invite_business_users":{"business_role_requests":[]}}}' }, "INVITE_RESULT_UNEXPECTED"],
]) {
    const page = createPage(response);
    const result = await inviteBusinessUser({ ...input, page });
    assert.equal(result.success, false);
    assert.equal(result.status, status);
    assert.equal(page.calls.length, 1);
}
const partial = await inviteBusinessUser({ ...input, page: createPage(),
    emails: ["one@example.test", "two@example.test"],
});
assert.equal(partial.status, "INVITE_RESULT_UNEXPECTED");
const noAssetsPage = createPage();
assert.equal((await inviteBusinessUser({ ...input, page: noAssetsPage, pageIds: [], adAccountIds: [] })).success, true);
assert.deepEqual(JSON.parse(new URLSearchParams(noAssetsPage.calls[0].body).get("variables")).input.assets, []);
console.log("Перевірки браузерного запрошення до БМ пройшли успішно");
