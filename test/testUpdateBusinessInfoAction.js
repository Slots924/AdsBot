import assert from "node:assert/strict";

import updateBusinessInfo, {
    updateBusinessInfoStatuses,
} from "../facebook/api-actions/ads-manager/updateBusinessInfo.js";


const commonPayload = {
    av: "user-id",
    __user: "user-id",
    __a: "1",
    fb_dtsg: "token",
    jazoest: "25522",
    lsd: "lsd-token",
    __comet_req: "58",
    __spin_r: "1048593722",
    __spin_b: "trunk",
    __spin_t: "1790514310",
    __crn: "comet.adsmanager.AdsBillingHubPaymentSettingsRouteDefinition",
};


// Створює page-заглушку та зберігає параметри GraphQL mutation.
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
    body: JSON.stringify({
        data: {
            billable_account_update: {
                payment_account: {
                    payment_legacy_account_id: "payment-account-id",
                    billable_account: {
                        id: "ad-account-id",
                        currency: "USD",
                        timezone_info: { timezone: "Europe/Kiev" },
                        billable_account_tax_info: {
                            business_name: "",
                            is_personal: false,
                            tax_id: "",
                            second_tax_id: null,
                            intl_address: {
                                city: "Washington",
                                region: "DC",
                                street: "1600 Pennsylvania Avenue NW",
                                postal_code: "20500",
                            },
                        },
                    },
                },
            },
        },
    }),
});
const result = await updateBusinessInfo({
    page,
    commonPayload,
    billableAccountPaymentLegacyAccountId: "payment-account-id",
});

assert.equal(result.success, true);
assert.equal(result.status, updateBusinessInfoStatuses.UPDATED);
assert.equal(result.data.businessInfo.currency, "USD");
assert.equal(result.data.businessInfo.paymentLegacyAccountId, "payment-account-id");

const parameters = new URLSearchParams(page.calls[0].requestBody);
assert.equal(
    parameters.get("fb_api_req_friendly_name"),
    "BillingAccountInformationUtilsUpdateAccountMutation"
);
assert.equal(parameters.get("doc_id"), "28163983213226133");
assert.equal(parameters.get("__aaid"), "payment-account-id");

const variables = JSON.parse(parameters.get("variables"));
assert.equal(variables.input.currency, "USD");
assert.deepEqual(variables.input.tax.business_address, {
    city: "Washington",
    country_code: "US",
    state: "DC",
    street1: "1600 Pennsylvania Avenue NW",
    street2: "",
    zip: "20500",
});
assert.equal(variables.input.upl_logging_data.context, "billingaccountinfo");
assert.equal(variables.input.upl_logging_data.target_name, parameters.get("fb_api_req_friendly_name"));

const invalidResult = await updateBusinessInfo({
    page: createPage({ ok: true, statusCode: 200, body: "{}" }),
    commonPayload,
    billableAccountPaymentLegacyAccountId: "",
});

assert.equal(invalidResult.success, false);
assert.equal(invalidResult.status, updateBusinessInfoStatuses.INVALID_INPUT);

console.log("Перевірка Facebook action оновлення business info пройшла успішно");
