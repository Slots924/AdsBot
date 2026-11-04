import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Manager from "../services/personalAccounts/PersonalAutouploadSessionManager.js";
import TaskReportManager from "../services/reports/TaskReportManager.js";
import HttpAdsManagerContext from "../facebook/autoupload/HttpAdsManagerContext.js";
import { cleanHistory } from "../services/reports/httpHistoryPolicy.js";
import { traceHttpRequest } from "../services/reports/HttpExchangeTrace.js";
import FacebookAccountManager from "../facebook/accounts/FacebookAccountManager.js";
import saveCreditCard from "../facebook/autoupload/actions/billing/saveCreditCard.js";

async function fixture(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "personal-http-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const events = [];
    const fbData = { userId: "123" };
    const client = {
        getFbData: () => fbData, getAdsManagerData: () => ({ session: {
            fb_dtsg: "test-dtsg", lsd: "test-lsd", clientRevision: "1", spinR: "1", spinB: "trunk", spinT: "1", cometReq: "15",
        } }), exportSession: () => ({ marker: "private-snapshot" }),
        getApiCredentials: () => ({ userAgent: "test", accessToken: "fake-token", cookie: "fake-cookie" }),
        createGraphApi: () => ({ getAdAccounts: async () => { events.push("assets"); return [{ id: "act_1", accountId: "1", name: "Test" }]; },
            getPages: async () => [], getAdPixels: async () => [] }),
    };
    let saved = null;
    const manager = new Manager({
        adsPower: { getProfileByNo: async () => ({ profile_id: "p1", name: "Test", group_id: "old" }),
            updateProfileName: async () => events.push("name"), updateProfileGroup: async () => events.push("group") },
        sessionStore: { load: async () => saved, save: async (_, value) => { events.push("save"); saved = value; } },
        restoreClient: () => client,
        refreshSession: async () => { events.push("refresh"); return { client, result: { capabilities: { adsManager: true } } }; },
        facebookAccountManager: { create: async () => { events.push("create"); return { accountKey: "account-065", name: "P065" }; } },
        reloadFacebookBackend: async () => {}, reportManager: new TaskReportManager({ reportsDirectory: path.join(directory, "tasks") }),
    });
    return { directory, manager, client, events };
}

test("персональне payment.add повертає статус ліміту з кодом Meta і зберігає його у звіті", async t => {
    const { manager, client } = await fixture(t);
    manager.creditCardStore = { getForUse: async () => ({ securityCode: "123" }) };
    const session = await manager.start({ profileNo: "2559" });
    const controller = new AbortController();
    let requests = 0;
    client.request = async () => { requests++; return { status: 200, data: JSON.stringify({ errors: [{ code: 4992003, message: "Limit" }] }) }; };
    manager.addCreditCard = async (receivedClient, input) => {
        assert.equal(receivedClient, client);
        assert.equal(input.context, manager.sessions.get(session.id).context);
        assert.equal(input.context.signal, controller.signal);
        assert.equal(input.card.securityCode, "123");
        assert.equal(input.resources, undefined);
        return saveCreditCard(input.context, { accountId: "1", mutationId: "2", riskQueryId: "3", input: {} });
    };
    const result = await manager.execute("payment.add", { sessionId: session.id, adAccountId: "1", cardId: "test", securityCode: "", signal: controller.signal });
    assert.equal(result.success, false);
    assert.equal(result.status, "CARD_ACCOUNT_LIMIT_REACHED");
    assert.equal(result.graphCode, 4992003);
    assert.equal(result.cardSaved, false);
    assert.equal(requests, 1);
    assert.equal(manager.sessions.get(session.id).context.signal, undefined);
    assert.equal(Object.hasOwn(result, "exchanges"), false);
    const item = (await manager.reportManager.list()).find(item => item.title.includes("payment.add"));
    assert.equal(item.status, "completed_with_warnings");
    const report = await manager.reportManager.get(item.id);
    assert.equal(report.resultSummary.value.status, "CARD_ACCOUNT_LIMIT_REACHED");
});

test("персональний workflow зберігає ID карти при додатковій перевірці", async t => {
    const { manager } = await fixture(t);
    manager.creditCardStore = { getForUse: async () => ({ securityCode: "123" }) };
    const session = await manager.start({ profileNo: "2559" });
    manager.addCreditCard = async () => ({ success: false, status: "AUTHENTICATION_REQUIRED",
        data: { paymentMethodId: "321", cardSaved: true, encryptionSucceeded: true }, exchanges: [{ test: true }] });
    const result = await manager.execute("payment.add", { sessionId: session.id, adAccountId: "1", cardId: "test" });
    assert.equal(result.paymentMethodId, "321");
    assert.equal(result.cardSaved, true);
    assert.equal(result.status, "AUTHENTICATION_REQUIRED");
    assert.equal(Object.hasOwn(result, "exchanges"), false);
});

test("після timeout прив'язки спільний контекст персональної сесії блокує наступний запис", async t => {
    const { manager, client } = await fixture(t);
    manager.creditCardStore = { getForUse: async () => ({ securityCode: "123" }) };
    const session = await manager.start({ profileNo: "2559" });
    let requests = 0;
    client.request = async () => { requests++; throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); };
    manager.addCreditCard = async (_, input) => saveCreditCard(input.context, { accountId: "1", mutationId: "2", riskQueryId: "3", input: {} });
    await assert.rejects(manager.execute("payment.add", { sessionId: session.id, adAccountId: "1", cardId: "test" }), error => error.outcomeUnknown);
    assert.equal(manager.sessions.get(session.id).context.writeBlocked, true);
    await assert.rejects(manager.execute("payment.add", { sessionId: session.id, adAccountId: "1", cardId: "test" }), error => error.outcomeUnknown);
    assert.equal(requests, 1);
});

test("HTTP-запуск зберігає сесію до читання активів і повторно використовує її без браузера", async t => {
    const { manager, events } = await fixture(t);
    const first = await manager.start({ profileNo: "2559" });
    assert.ok(events.indexOf("save") < events.indexOf("assets"));
    assert.equal(first.overview.adAccounts.length, 1);
    assert.equal(first.context, "HTTP_ADS_MANAGER");
    assert.ok(!JSON.stringify(first).includes("private-snapshot"));
    const second = await manager.start({ profileNo: "2559" });
    assert.equal(second.id, first.id);
    assert.equal(events.filter(event => event === "refresh").length, 1);
    assert.ok(Array.isArray(await manager.execute("accounts", { sessionId: first.id })));
});

test("часткова помилка застосування групи не створює API-клієнта повторно", async t => {
    const { manager, events } = await fixture(t);
    manager.adsPower.updateProfileGroup = async () => { throw new Error("offline"); };
    const session = await manager.start({ profileNo: "2559" });
    const input = { sessionId: session.id, name: "P065", groupId: "farm" };
    const first = await manager.execute("api.create", input);
    assert.equal(first.account.accountKey, "account-065");
    assert.ok(first.profileUpdateWarning);
    await manager.execute("api.create", input);
    assert.equal(events.filter(event => event === "create").length, 1);
});

test("HTTP-відмова створює звіт з відповіддю до помилки парсингу", async t => {
    const { manager, directory } = await fixture(t);
    await assert.rejects(manager.reported("test", "2559", async () => {
        await traceHttpRequest({ url: "https://adsmanager.facebook.com/api/graphql/", method: "post", data: "x=1" }, async () => ({
            status: 200, headers: {}, data: '{"errors":[{"message":"Test failure"}]}' }));
        throw Object.assign(new Error("bad response"), { code: "TEST_ERROR" });
    }));
    const reports = await manager.reportManager.list();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].status, "failed");
    const files = await readdir(path.join(directory, "http"));
    const history = await readFile(path.join(directory, "http", files[0]), "utf8");
    assert.match(history, /request.finished/);
    assert.match(history, /Test failure/);
});

test("невизначений POST блокує наступну mutation, але дозволяє читання", async () => {
    let calls = 0;
    const client = { getFbData: () => ({ userId: "123" }), getAdsManagerData: () => ({ session: { fb_dtsg: "fake", lsd: "fake" } }),
        request: async () => { calls++; return { status: 200, data: "broken" }; } };
    const context = new HttpAdsManagerContext(client, "p1");
    const body = new URLSearchParams({ __user: "123" }).toString();
    await assert.rejects(context.postForm({ body, friendlyName: "TestMutation" }), error => error.outcomeUnknown);
    await assert.rejects(context.postForm({ body, friendlyName: "TestMutation" }), error => error.outcomeUnknown);
    assert.equal(calls, 1);
    client.request = async () => { calls++; return { status: 200, data: '{"data":{"account":{}}}' }; };
    await context.postForm({ body, friendlyName: "TestQuery" });
    assert.equal(calls, 2);
});

test("історія платіжного запиту приховує PAN, CVV, PTT і вкладені sensitive_string_value", () => {
    const value = cleanHistory({ input: { card_data: { credit_card_number: { sensitive_string_value: "test-pan" }, csc: { sensitive_string_value: "test-cvv" } }, platform_trust_token: "test-ptt" }, diagnostics: { sensitive_string_value: "test-secret" } });
    const text = JSON.stringify(value);
    for (const secret of ["test-pan", "test-cvv", "test-ptt", "test-secret"]) assert.ok(!text.includes(secret));
});

test("бізнес-інфо читається через HTTP-транспорт без Puppeteer", async t => {
    const { manager, client } = await fixture(t);
    const calls = [];
    client.requestGraph = async (_, endpoint, parameters) => {
        calls.push({ endpoint, parameters });
        return { id: "act_1", currency: "USD", timezone_name: "Europe/Kiev", business_name: "Test company", business_country_code: "US", business_city: "Washington" };
    };
    const session = await manager.start({ profileNo: "2559" });
    const value = await manager.execute("business.check", { sessionId: session.id, adAccountId: "1" });
    assert.equal(value.businessName, "Test company");
    assert.equal(value.currency, "USD");
    assert.equal(value.city, "Washington");
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.endpoint === "act_1"));
});

test("перевірка телефону передає РК у HTTP GraphQL і читає підтверджений стан", async t => {
    const { manager, client } = await fixture(t);
    let request;
    client.request = async config => {
        request = new URLSearchParams(config.data);
        return { status: 200, data: JSON.stringify({ data: { ad_account: { start_your_day_init_task_widgets: [
            { taskType: "PHONE_NUMBER_VERIFICATION", completionStatus: "COMPLETE" },
        ] } } }) };
    };
    const session = await manager.start({ profileNo: "2559" });
    const result = await manager.execute("phone.check", { sessionId: session.id, adAccountId: "1" });
    assert.equal(result.phoneStatus, "LINKED");
    assert.equal(request.get("__aaid"), "1");
    assert.equal(request.get("fb_api_req_friendly_name"), "SYDNUOWidgetContainerQuery");
});

test("пікселі отримують Graph ID з act_ і для огляду, і для вибраного числового РК", async t => {
    const { manager, client } = await fixture(t);
    const ids = [];
    client.createGraphApi = () => ({ getAdAccounts: async () => [{ id: "act_1", accountId: "1" }], getPages: async () => [],
        getAdPixels: async id => { ids.push(id); assert.equal(id, "act_1"); return [{ id: "2", name: "Test pixel" }]; } });
    const session = await manager.start({ profileNo: "2559" });
    assert.equal(session.overview.adAccounts[0].pixels.length, 1);
    assert.equal((await manager.execute("pixels", { sessionId: session.id, adAccountId: "1" })).length, 1);
    assert.deepEqual(ids, ["act_1", "act_1"]);
});

test("GraphQL-відмова не втрачає код Facebook при повторному використанні API-екшену", async t => {
    const { manager, client } = await fixture(t);
    const calls = [];
    client.requestGraph = async () => ({ id: "act_1", currency: "USD", timezone_name: "Europe/Kiev" });
    client.request = async config => {
        calls.push(config);
        return { status: 200, data: JSON.stringify({ errors: [{ code: 190, message: "Expired test session" }] }) };
    };
    let removed = false;
    manager.sessionStore.remove = async () => { removed = true; };
    const session = await manager.start({ profileNo: "2559" });
    await assert.rejects(manager.execute("business.update", { sessionId: session.id, adAccountId: "1", tax: {} }), error =>
        error.code === "FACEBOOK_GRAPHQL_ERROR" && error.graphCode === 190);
    assert.equal(calls.length, 1);
    assert.equal(removed, true);
});

test("нумерація API-клієнтів збігається з внутрішнім номером навіть при одночасному створенні", async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "personal-api-name-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const manager = new FacebookAccountManager({ accountsFile: path.join(directory, "accounts.json") });
    assert.equal(await manager.nextPersonalName(), "P001");
    const accounts = await Promise.all([1, 2].map(() => manager.create({ autoPersonalName: true,
        name: "P001", adsPowerProfileNo: "1", userAgent: "test", accessToken: "test-token" })));
    assert.deepEqual(accounts.map(account => account.name), ["P001", "P002"]);
    assert.equal(await manager.nextPersonalName(), "P003");
});

test("збій збереження звіту не змінює підтверджений результат дії", async t => {
    const { manager } = await fixture(t);
    manager.reportManager.createFromTask = async () => { throw new Error("disk full"); };
    const result = await manager.reported("confirmed", "1", async () => ({ success: true }));
    assert.equal(result.success, true);
    assert.ok(result.storageWarning);
});

test("HTTP-оновлення бізнес-інфо зберігає податкові дані й не повторює mutation при збої контрольного читання", async t => {
    const { manager, client } = await fixture(t);
    let reads = 0;
    const writes = [];
    client.requestGraph = async () => {
        if (++reads > 2) throw new Error("Read unavailable");
        return { id: "act_1", currency: "USD", timezone_name: "Europe/Kiev", business_name: "Original business" };
    };
    client.request = async config => {
        const form = new URLSearchParams(config.data);
        if (form.get("fb_api_req_friendly_name") === "BillingAccountInformationScreenQuery") return {
            status: 200, data: JSON.stringify({ data: { payment_account: { billable_account: {
                billable_account_tax_info: { business_name: "Stored business", tax_id: "test-tax-id", is_personal: true },
            } } } }),
        };
        writes.push(JSON.parse(form.get("variables")).input);
        return { status: 200, data: JSON.stringify({ data: { billable_account_update: { payment_account: {
            payment_legacy_account_id: "1", billable_account: { id: "1", currency: "USD" },
        } } } }) };
    };
    const session = await manager.start({ profileNo: "2559" });
    const result = await manager.execute("business.update", { sessionId: session.id, adAccountId: "1", tax: {
        businessAddress: { street1: "Test street", city: "Washington", state: "DC", zip: "20500", countryCode: "US" },
    } });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].tax.business_name, "Stored business");
    assert.equal(writes[0].tax.tax_id, "test-tax-id");
    assert.equal(writes[0].tax.is_personal_use, true);
    assert.equal(result.city, "Washington");
    assert.ok(result.refreshError);
});

test("HTTP-підтвердження телефону проходить повний SMS-flow і не повертає службовий стан в GUI", async t => {
    const { manager, client } = await fixture(t);
    const screen = (type, state, extra = {}) => ({ __typename: type, serialized_state: state, ...extra });
    const replies = [
        { ixt_xfac_bv_trigger: { screen: { display_type: "OVERLAY", view_model: screen("BVWizardAdvertiserVerificationEnterPhoneIXTScreenViewModel", "private-state-1") } } },
        { ixt_screen_next: { view_model: screen("ChallengeSelectIXTScreenViewModel", "private-state-2", {
            challenge_select_screen_content_renderer: { bv_wizard_challenge_select_screen: { challenge_method_options: ["SMS"] } },
        }) } },
        { ixt_screen_next: { view_model: screen("ChallengeSMSConfirmIXTScreenViewModel", "private-state-3", {
            bv_wizard_challenge_sms_confirm_screen: { phone_number: "test-phone" },
        }) } },
        { ixt_screen_next: { view_model: screen("ChallengeSMSEnterCodeIXTScreenViewModel", "private-state-4", { submission_id: "private-submission" }) } },
        { ixt_screen_next: { view_model: screen("XFBBVWizardAdvertiserVerificationAdsManagerPhoneConsentIXTScreenViewModel", "private-state-5") } },
    ];
    let calls = 0;
    client.request = async () => { calls++; assert.ok(replies.length); return { status: 200, data: JSON.stringify({ data: replies.shift() }) }; };
    const session = await manager.start({ profileNo: "2559" });
    const requested = await manager.execute("phone.request", { sessionId: session.id, adAccountId: "1", phoneE164: "+12025550123", countryCode: "US", method: "SMS" });
    assert.ok(!JSON.stringify(requested).includes("private-state"));
    const confirmed = await manager.execute("phone.submit", { sessionId: session.id, code: "123456" });
    assert.equal(confirmed.phoneVerified, true);
    assert.ok(!JSON.stringify(confirmed).includes("private-state"));
    assert.equal(calls, 5);
    await assert.rejects(manager.execute("phone.submit", { sessionId: session.id, code: "123456" }), /Спочатку надішліть код/);
    assert.equal(calls, 5);
});
