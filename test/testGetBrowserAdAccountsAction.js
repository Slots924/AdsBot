import assert from "node:assert/strict";

import getAdAccounts, {
    getBrowserAdAccountsStatuses,
} from "../facebook/api-actions/ads-manager/getAdAccounts.js";


function pageWith(response) {
    const calls = [];
    return {
        calls,
        async evaluate(_callback, input) {
            calls.push(input);
            return response;
        },
    };
}


const page = pageWith({
    ok: true,
    statusCode: 200,
    accounts: [{
        id: "act_123",
        account_id: "123",
        name: "Main",
        account_status: 1,
        currency: "USD",
    }],
});
const result = await getAdAccounts({ page, accessToken: "test-token" });
assert.equal(result.success, true);
assert.equal(result.status, getBrowserAdAccountsStatuses.ACCOUNTS_FETCHED);
assert.deepEqual(result.data, [{
    id: "act_123",
    accountId: "123",
    name: "Main",
    accountStatus: 1,
    disableReason: null,
    currency: "USD",
    timezoneName: null,
}]);
assert.equal(page.calls[0].tokenValue, "test-token");
assert.equal(JSON.stringify(result).includes("test-token"), false);

const failed = await getAdAccounts({
    page: pageWith({ ok: false, statusCode: 400, graphError: { message: "Bad token", code: 190 } }),
    accessToken: "test-token",
});
assert.equal(failed.status, getBrowserAdAccountsStatuses.GRAPH_API_ERROR);
assert.equal(failed.graphCode, 190);

console.log("Перевірка browser action списку рекламних акаунтів пройшла успішно");
