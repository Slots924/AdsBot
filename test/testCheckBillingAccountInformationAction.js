import assert from "node:assert/strict";

import checkBillingAccountInformation, {
    checkBillingAccountInformationStatuses,
} from "../facebook/api-actions/ads-manager/checkBillingAccountInformation.js";


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


// Створює page-заглушку та зберігає параметри GraphQL query.
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
            payment_account: {
                billing_flags: ["TAX_INFO_PROBLEM_SOFT_CRTICAL"],
                billable_account: {
                    billable_account_tax_info: {
                        business_name: "",
                        business_country_code: "US",
                        predicated_business_country_code: "US",
                        intl_address: {
                            street: "",
                            building: "",
                            city: "Washington",
                            region: "DC",
                            postal_code: "20500",
                        },
                        tax_id: "",
                        tax_id_type_enum: "NONE",
                        is_personal: false,
                        business_verification_type: null,
                    },
                },
            },
        },
    }),
});
const result = await checkBillingAccountInformation({
    page,
    commonPayload,
    paymentAccountId: "payment-account-id",
});

assert.equal(result.success, true);
assert.equal(result.status, checkBillingAccountInformationStatuses.CHECKED);
assert.equal(result.data.paymentAccountId, "payment-account-id");
assert.equal(result.data.needsBusinessInfo, true);
assert.deepEqual(result.data.problems, ["TAX_INFO_PROBLEM_SOFT_CRTICAL"]);
assert.deepEqual(result.data.missingFields, ["business_name", "street"]);

const parameters = new URLSearchParams(page.calls[0].requestBody);
assert.equal(
    parameters.get("fb_api_req_friendly_name"),
    "BillingAccountInformationScreenQuery"
);
assert.equal(parameters.get("doc_id"), "28130792889912915");
assert.equal(parameters.get("__aaid"), "payment-account-id");
assert.deepEqual(JSON.parse(parameters.get("variables")), {
    paymentAccountID: "payment-account-id",
});

const noProblemResult = await checkBillingAccountInformation({
    page: createPage({
        ok: true,
        statusCode: 200,
        body: JSON.stringify({
            data: {
                payment_account: {
                    billing_flags: [],
                    billable_account: {
                        billable_account_tax_info: {
                            business_name: "Example Business",
                            intl_address: {
                                street: "Example street",
                                city: "Washington",
                                postal_code: "20500",
                            },
                        },
                    },
                },
            },
        }),
    }),
    commonPayload,
    paymentAccountId: "payment-account-id",
});

assert.equal(noProblemResult.success, true);
assert.equal(noProblemResult.data.needsBusinessInfo, false);
assert.deepEqual(noProblemResult.data.missingFields, []);

console.log("Перевірка Facebook action billing account information пройшла успішно");
