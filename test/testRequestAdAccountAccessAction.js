import assert from "node:assert/strict";

import requestAdAccountAccess, {
    requestAdAccountAccessStatuses,
} from "../facebook/api-actions/ads-manager/requestAdAccountAccess.js";


function createPage(response, runtime = {
    actorId: "123456789",
    fbDtsg: "abc",
    lsd: "lsd-token",
}) {
    const calls = [];
    return {
        calls,
        url: () => "https://business.facebook.com/settings/ad-accounts",
        async evaluate(_callback, args) {
            calls.push(args);
            return calls.length === 1 ? runtime : response;
        },
    };
}


const page = createPage({
    ok: true,
    statusCode: 200,
    body: 'for (;;);{"data":{"business_settings_request_ad_account_access":{"access_status":"PENDING","admarket_id":"987"}}}',
});
const pending = await requestAdAccountAccess({ page, adAccountId: "act_1760236478435080" });
assert.equal(pending.success, true);
assert.equal(pending.status, requestAdAccountAccessStatuses.PENDING);
assert.deepEqual(pending.data, {
    adAccountId: "1760236478435080",
    businessId: "703191138787237",
    accessStatus: "PENDING",
    admarketId: "987",
    adMarketId: "987",
});
const request = page.calls[1];
const body = new URLSearchParams(request.requestBody);
assert.equal(request.requestEndpoint, "/api/graphql/");
assert.equal(body.get("doc_id"), "23962130140039997");
assert.equal(body.get("fb_api_req_friendly_name"), "BizKitSettingsRequestAdAccountAccessMutation");
assert.equal(body.get("jazoest"), "2294");
assert.equal(body.get("__bid"), "703191138787237");
assert.deepEqual(JSON.parse(body.get("variables")), {
    input: {
        actor_id: "123456789",
        client_mutation_id: "3",
        ad_account_id: "1760236478435080",
        permitted_roles: [
            "864195700451909",
            "151821535410699",
            "610690166001223",
            "186595505260379",
        ],
        permitted_tasks: [],
        requesting_business_id: "703191138787237",
    },
});

const limit = await requestAdAccountAccess({
    page: createPage({
        ok: true,
        statusCode: 200,
        body: JSON.stringify({ errors: [{
            code: 1752207,
            api_error_code: 100,
            summary: "Your Business already has too many Pending Requests.",
            description: "Your business has already exceeded the limit of 2 pending requests.",
            fbtrace_id: "trace-1",
        }] }),
    }),
    adAccountId: "1760236478435080",
});
assert.equal(limit.success, false);
assert.equal(limit.status, requestAdAccountAccessStatuses.PENDING_REQUEST_LIMIT);
assert.deepEqual(limit.graphErrors[0], {
    code: 1752207,
    apiErrorCode: 100,
    summary: "Your Business already has too many Pending Requests.",
    description: "Your business has already exceeded the limit of 2 pending requests.",
    fbtraceId: "trace-1",
});

const unexpected = await requestAdAccountAccess({
    page: createPage({ ok: true, statusCode: 200, body: '{"data":{}}' }),
    adAccountId: "1760236478435080",
});
assert.equal(unexpected.success, false);
assert.equal(unexpected.status, requestAdAccountAccessStatuses.ACCESS_STATUS_UNEXPECTED);

const unavailable = await requestAdAccountAccess({
    page: createPage(null, null),
    adAccountId: "1760236478435080",
});
assert.equal(unavailable.status, requestAdAccountAccessStatuses.RUNTIME_DATA_UNAVAILABLE);
assert.equal(unavailable.success, false);

const wrongOrigin = await requestAdAccountAccess({
    page: { ...createPage(null), url: () => "https://www.facebook.com/" },
    adAccountId: "1760236478435080",
});
assert.equal(wrongOrigin.status, requestAdAccountAccessStatuses.INVALID_INPUT);

console.log("Перевірка запиту доступу до рекламного акаунта пройшла успішно");
