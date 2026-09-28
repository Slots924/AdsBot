import assert from "node:assert/strict";

import addCreditCardPaymentMethod, {
    addCreditCardPaymentMethodStatuses,
} from "../facebook/api-actions/ads-manager/addCreditCardPaymentMethod.js";


// Створює заглушку page з безпечною відповіддю browser runtime.
function createPage(runtimeResult) {
    const calls = [];

    return {
        calls,
        async evaluate(_callback, argumentsObject) {
            calls.push(argumentsObject);
            return runtimeResult;
        },
    };
}


const addedPage = createPage({
    status: "ADDED",
    paymentMethodId: "payment-method-id",
    network: "Mastercard",
    last4: "0002",
});
const addedResult = await addCreditCardPaymentMethod({
    page: addedPage,
    paymentAccountId: "payment-account-id",
    cardNumber: "4000 0000 0000 0002",
    securityCode: "123",
    expiration: "09/28",
    cardholderName: "Test Cardholder",
    postalCode: "20500",
});

assert.equal(addedResult.success, true);
assert.equal(addedResult.status, addCreditCardPaymentMethodStatuses.ADDED);
assert.deepEqual(addedResult.data, {
    paymentMethodId: "payment-method-id",
    network: "Mastercard",
    last4: "0002",
});
assert.equal(addedPage.calls.length, 1);
assert.equal(addedPage.calls[0].pan, "4000000000000002");
assert.equal(addedPage.calls[0].cvv, "123");

const authenticationResult = await addCreditCardPaymentMethod({
    page: createPage({
        status: "AUTHENTICATION_REQUIRED",
        paymentMethodId: "payment-method-id",
        verification: { credential_authentication_id: "authentication-id" },
    }),
    paymentAccountId: "payment-account-id",
    cardNumber: "4000000000000002",
    securityCode: "123",
    expiration: "09/28",
    cardholderName: "Test Cardholder",
    postalCode: "20500",
});

assert.equal(authenticationResult.success, false);
assert.equal(
    authenticationResult.status,
    addCreditCardPaymentMethodStatuses.AUTHENTICATION_REQUIRED
);
assert.equal(authenticationResult.data.paymentMethodId, "payment-method-id");

const unavailableRuntimeResult = await addCreditCardPaymentMethod({
    page: createPage({
        status: "RUNTIME_MODULE_UNAVAILABLE",
        moduleName: "BillingPTTUtils",
    }),
    paymentAccountId: "payment-account-id",
    cardNumber: "4000000000000002",
    securityCode: "123",
    expiration: "09/28",
    cardholderName: "Test Cardholder",
    postalCode: "20500",
});

assert.equal(unavailableRuntimeResult.success, false);
assert.equal(
    unavailableRuntimeResult.status,
    addCreditCardPaymentMethodStatuses.RUNTIME_MODULE_UNAVAILABLE
);
assert.equal(unavailableRuntimeResult.moduleName, "BillingPTTUtils");

const unavailableContextResult = await addCreditCardPaymentMethod({
    page: createPage({
        status: "RUNTIME_CONTEXT_UNAVAILABLE",
        failureStage: "BUILD_BILLING_CONTEXT_SNAPSHOTS",
        pageContext: { hostname: "adsmanager.facebook.com", pathname: "/billing_hub/payment_settings/" },
        contextDiagnostics: {
            gkSnapshotAvailable: false,
            qeSnapshotAvailable: true,
            responseTopLevelKeys: ["data"],
            dataTopLevelKeys: ["billing_context"],
            graphqlErrorCount: 0,
            graphqlErrorCodes: [],
            responseShape: { type: "object", keys: ["__fragments"] },
        },
        billingDiagnostics: [
            {
                event: "billing_context_query_start",
                request: {
                    operationName: "BillingContextFactoryQuery",
                    documentId: "safe-test-id",
                    variableNames: ["paymentAccountID"],
                    variableTypes: { paymentAccountID: "string" },
                    paymentAccountIdMasked: "********2834",
                },
            },
        ],
    }),
    paymentAccountId: "payment-account-id",
    cardNumber: "4000000000000002",
    securityCode: "123",
    expiration: "09/28",
    cardholderName: "Test Cardholder",
    postalCode: "20500",
});

assert.equal(unavailableContextResult.success, false);
assert.equal(
    unavailableContextResult.status,
    addCreditCardPaymentMethodStatuses.RUNTIME_CONTEXT_UNAVAILABLE
);
assert.equal(unavailableContextResult.failureStage, "BUILD_BILLING_CONTEXT_SNAPSHOTS");
assert.deepEqual(unavailableContextResult.contextDiagnostics, {
    gkSnapshotAvailable: false,
    qeSnapshotAvailable: true,
    responseTopLevelKeys: ["data"],
    dataTopLevelKeys: ["billing_context"],
    graphqlErrorCount: 0,
    graphqlErrorCodes: [],
    responseShape: { type: "object", keys: ["__fragments"] },
});
assert.equal(unavailableContextResult.billingDiagnostics[0].request.paymentAccountIdMasked, "********2834");

const invalidResult = await addCreditCardPaymentMethod({
    page: createPage({ status: "ADDED" }),
    paymentAccountId: "",
    cardNumber: "invalid",
    securityCode: "1",
    expiration: "2028-09",
    cardholderName: "",
    postalCode: "",
});

assert.equal(invalidResult.success, false);
assert.equal(invalidResult.status, addCreditCardPaymentMethodStatuses.INVALID_INPUT);

console.log("Перевірка Facebook action додавання платіжної карти пройшла успішно");
