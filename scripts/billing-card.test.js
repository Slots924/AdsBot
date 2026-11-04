import test from "node:test";
import assert from "node:assert/strict";
import saveCreditCard, { cardStatuses } from "../facebook/autoupload/actions/billing/saveCreditCard.js";
import addCreditCard from "../facebook/autoupload/actions/billing/addCreditCard.js";
import HttpAdsManagerContext from "../facebook/autoupload/HttpAdsManagerContext.js";
import { isCardAccountLimitError } from "../facebook/api/billingCardErrors.js";
import resources from "../facebook/autoupload/encryption/billingPaymentResources.js";
import FacebookBillingModules from "../facebook/autoupload/encryption/FacebookBillingModules.js";

const options = { accountId: "123", mutationId: "456", riskQueryId: "789", input: { platform_trust_token: "test-only" } };
const saved = status => ({ xfb_billing_save_card_credential: { credit_card: { credential_id: "321" }, card_verification_status: status } });
const risk = value => ({ payment_account: { billable_account: { specific_credential_required_risk_verification_info: value } } });
function fixture(respond) {
    const calls = [];
    const client = {
        getFbData: () => ({ userId: "123" }), getAdsManagerData: () => ({ session: { fb_dtsg: "test", lsd: "test" } }),
        request: async request => {
            const name = request.headers["X-FB-Friendly-Name"];
            calls.push({ name, mutation: request.mutation });
            return { status: 200, data: JSON.stringify(await respond(name)), headers: {} };
        },
    };
    return { client, context: new HttpAdsManagerContext(client, "p1"), calls };
}

test("код 4992003 при HTTP 200 повертає окремий статус після одного запису", async () => {
    const { context, calls } = fixture(() => ({ errors: [{ code: 4992003, message: "Remove it from another account and try again" }] }));
    const result = await saveCreditCard(context, options);
    assert.equal(result.status, cardStatuses.CARD_ACCOUNT_LIMIT_REACHED);
    assert.equal(result.success, false);
    assert.equal(result.graphCode, 4992003);
    assert.equal(result.data.cardSaved, false);
    assert.equal(result.data.encryptionSucceeded, true);
    assert.equal(result.outcomeUnknown, false);
    assert.equal(calls.length, 1);
    assert.equal(context.writeBlocked, false);
});

test("ліміт визначається за кодом незалежно від мови й не поглинає інші помилки", () => {
    assert.equal(isCardAccountLimitError({ graphCode: "4992003", message: "Інша мова" }), true);
    assert.equal(isCardAccountLimitError({ errors: [{ api_error_code: 4992003 }] }), true);
    assert.equal(isCardAccountLimitError({ code: "FACEBOOK_GRAPHQL_ERROR", message: "Remove it from another account" }), true);
    assert.equal(isCardAccountLimitError({ graphCode: 190, message: "Remove it from another account" }), false);
    assert.equal(isCardAccountLimitError({ graphCode: 4992003, outcomeUnknown: true }), false);
    assert.equal(isCardAccountLimitError({ code: "ETIMEDOUT", message: "4992003" }), false);
});

test("інша GraphQL-відмова зберігає код та етап, без повтору", async () => {
    const { context, calls } = fixture(() => ({ errors: [{ code: 200, message: "Permission denied" }] }));
    await assert.rejects(saveCreditCard(context, options), error => error.code === "FACEBOOK_GRAPHQL_ERROR"
        && error.graphCode === 200 && error.stage === "CARD_SAVE" && error.encryptionSucceeded);
    assert.equal(calls.length, 1);
});

test("після SUCCESS виконується risk-читання, лише повний результат означає ADDED", async () => {
    const { context, calls } = fixture(name => name.endsWith("Query") ? { data: risk(null) } : { data: saved("SUCCESS") });
    const result = await saveCreditCard(context, options);
    assert.equal(result.success, true);
    assert.equal(result.status, "ADDED");
    assert.equal(result.data.paymentMethodId, "321");
    assert.deepEqual(calls, [{ name: "BillingSaveCardCredentialStateMutation", mutation: true }, { name: "BillingCheckRiskStateQuery", mutation: false }]);
});

test("збережений credential з вимогою підтвердження не губиться", async () => {
    const { context, calls } = fixture(() => ({ data: saved("AUTHENTICATION_REQUIRED") }));
    const result = await saveCreditCard(context, options);
    assert.equal(result.status, "AUTHENTICATION_REQUIRED");
    assert.equal(result.data.cardSaved, true);
    assert.equal(result.data.paymentMethodId, "321");
    assert.equal(calls.length, 1);
});

test("risk-відмова, timeout і неповна відповідь не повторюють запис збереженої карти", async () => {
    for (const response of [null, {}, { errors: [{ code: 200, message: "Read denied" }] }, { data: risk({ required: true }) }]) {
        const { context, calls } = fixture(name => name.endsWith("Query") ? response : { data: saved("SUCCESS") });
        const result = await saveCreditCard(context, options);
        assert.equal(result.success, false);
        assert.equal(result.status, response?.data ? "REQUIRES_RISK_VERIFICATION" : "RISK_CHECK_FAILED");
        assert.equal(result.data.cardSaved, true);
        assert.equal(calls.filter(call => call.mutation).length, 1);
    }
});

test("невизначений запис блокує наступне додавання в тому самому контексті", async () => {
    const { client, context, calls } = fixture(() => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); });
    await assert.rejects(saveCreditCard(context, options), error => error.outcomeUnknown && error.stage === "CARD_SAVE");
    const input = { profileId: "p1", adAccountId: "123", context,
        card: { cardNumber: "4111111111111111", securityCode: "123", expiration: "12/30" } };
    await assert.rejects(addCreditCard(client, input), { code: "FACEBOOK_WRITE_OUTCOME_UNKNOWN" });
    assert.equal(calls.length, 1);
});

test("HTTP 200 без підтвердженого credential блокує повтор mutation", async () => {
    const { context, calls } = fixture(() => ({ data: {} }));
    await assert.rejects(saveCreditCard(context, options), error => error.code === "FACEBOOK_WRITE_NOT_CONFIRMED" && error.outcomeUnknown);
    assert.equal(context.writeBlocked, true);
    assert.equal(calls.length, 1);
});

test("екшен має ресурси обох платіжних GraphQL-модулів за замовчуванням", () => {
    assert.ok(resources.some(item => item.moduleNames.includes("BillingSaveCardCredentialStateMutation.graphql")));
    assert.ok(resources.some(item => item.moduleNames.includes("BillingCheckRiskStateQuery.graphql")));
});

test("звичайний екшен із GUI передає перевірені ресурси завантажувачу без ручних прапорців", async t => {
    const client = { request: async () => ({ data: "<html></html>" }) };
    const stop = Object.assign(new Error("preflight inspected"), { code: "TEST_PREFLIGHT" });
    t.mock.method(FacebookBillingModules.prototype, "loadRoots", async function (roots, input) {
        assert.ok(roots.includes("BillingCheckRiskStateQuery.graphql"));
        assert.equal(input.resources, resources);
        throw stop;
    });
    await assert.rejects(addCreditCard(client, { profileId: "p1", adAccountId: "123",
        card: { cardNumber: "4111111111111111", securityCode: "123", expiration: "12/30" } }), error => error === stop);
});

test("risk-timeout після збереження не повторює mutation й не губить credential", async () => {
    const { context, calls } = fixture(name => {
        if (name.endsWith("Query")) throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
        return { data: saved("SUCCESS") };
    });
    const result = await saveCreditCard(context, options);
    assert.equal(result.status, "RISK_CHECK_FAILED");
    assert.equal(result.data.paymentMethodId, "321");
    assert.equal(result.data.cardSaved, true);
    assert.equal(calls.length, 2);
    assert.equal(context.writeBlocked, false);
});
