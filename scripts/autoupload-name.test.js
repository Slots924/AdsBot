import test from "node:test";
import assert from "node:assert/strict";
import changeName from "../facebook/autoupload/actions/accounts/changeFacebookName.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";

const html = 'DTSGInitialData",[],{"token":"test-dtsg"} LSD",[],{"token":"test-lsd"} {"actorID":"123"}';
function fixture({ available = true, valid = true, update = { error: null }, failWrite = false, partialError = false } = {}) {
    const calls = [];
    const client = {
        run: fn => fn(), validateFbData: () => {},
        request: async config => {
            calls.push(config);
            if (!config.method) return { status: 200, data: html };
            const form = new URLSearchParams(config.data);
            const operation = form.get("fb_api_req_friendly_name");
            if (failWrite && operation === "useFXIMUpdateNameMutation") throw new Error("timeout");
            const data = operation === "FXIMIdentityNameEditorDialogQuery"
                ? { fxim_identity_for_id: { canonical_id: "123", screen_rules: { name: { legacy_name_data: { can_change_name: available }, cooldown_status: false } } } }
                : operation === "useFXIMNameValidatorQuery" ? { fx_identity_management: { validate_name_v2: { is_valid: valid } } }
                : update === null ? {} : { fxim_update_identity_name: update };
            return { status: 200, headers: {}, data: JSON.stringify({ data, ...(partialError && operation === "useFXIMUpdateNameMutation" ? { errors: [{ code: 123, message: "Partial error test-dtsg" }] } : {}) }) };
        },
    };
    return { calls, fbData: { userId: "123", session: {}, client } };
}
const name = { firstName: " Test ", lastName: "User" };

test("зміна соціального імені використовує Accounts Center, актуальні токени та поточний userId", async () => {
    const { calls, fbData } = fixture();
    const result = await changeName(fbData, name);
    assert.equal(result.success, true);
    assert.equal(calls.length, 4);
    const write = calls[3];
    assert.equal(write.url, "https://accountscenter.facebook.com/api/graphql/");
    assert.equal(write.headers.Origin, "https://accountscenter.facebook.com");
    const form = new URLSearchParams(write.data);
    assert.equal(form.get("doc_id"), "9538143859625836");
    assert.equal(form.get("fb_dtsg"), "test-dtsg");
    assert.equal(form.get("__crn"), "comet.fx.accounts_center.name.editor");
    const variables = JSON.parse(form.get("variables"));
    assert.deepEqual(variables.identity_ids, ["123"]);
    assert.equal(variables.full_name, "Test User");
    assert.equal(variables.interface, "FB_WEB");
    assert.equal(write.mutation, true);
    assert.ok(!JSON.stringify(result).includes("test-dtsg"));
});

test("недоступна зміна або невалідне ім’я зупиняються до mutation", async () => {
    for (const options of [{ available: false }, { valid: false }]) {
        const { calls, fbData } = fixture(options);
        assert.equal((await changeName(fbData, name)).success, false);
        assert.equal(calls.filter(call => call.mutation === true).length, 0);
    }
});

test("відмова, відсутнє підтвердження та timeout не є успіхом і не повторюють mutation", async () => {
    for (const options of [{ update: { error: {} } }, { update: null }, { failWrite: true }]) {
        const { calls, fbData } = fixture(options);
        const result = await changeName(fbData, name);
        assert.equal(result.success, false);
        assert.equal(calls.filter(call => call.mutation === true).length, 1);
        assert.equal(result.outcomeUnknown, !options.update);
        if (result.outcomeUnknown) assert.equal(result.actionRequired, "check_profile_name");
    }
});

test("без збереженої сесії сервіс записує помилку без відкриття браузера", async () => {
    const entries = [];
    const service = new AutouploadService({
        store: { snapshot: async () => ({ profiles: [{ profileId: "p1", profileNo: "1" }] }), recordAction: async (id, entry) => entries.push({ id, ...entry }) },
        checkSession: () => { throw new Error("Браузер не повинен відкриватися"); },
    });
    const result = await service.changeNames(["p1"], name);
    assert.equal(result.taskStatus, "completed_with_warnings");
    assert.equal(entries[0].code, "FACEBOOK_SESSION_PREPARATION_FAILED");
    assert.equal(entries[0].operation, "profile-name-change");
});

test("чужий профіль Accounts Center блокує всі GraphQL-запити", async () => {
    const { fbData, calls } = fixture();
    fbData.userId = "999";
    const result = await changeName(fbData, name);
    assert.equal(result.code, "FACEBOOK_SESSION_MISMATCH");
    assert.equal(calls.length, 1);
});

test("часткова GraphQL-помилка після mutation не маскується успіхом і приховує токен", async () => {
    const { fbData } = fixture({ partialError: true });
    const result = await changeName(fbData, name);
    assert.equal(result.success, false);
    assert.equal(result.graphCode, 123);
    assert.equal(result.outcomeUnknown, true);
    assert.ok(!JSON.stringify(result).includes("test-dtsg"));
});

test("скасування перед mutation не записує ім’я та не позначає результат невідомим", async () => {
    const { fbData, calls } = fixture();
    const controller = new AbortController();
    const result = await changeName(fbData, name, { signal: controller.signal, beforeSend: () => controller.abort() });
    assert.equal(result.success, false);
    assert.equal(result.outcomeUnknown, false);
    assert.equal(calls.filter(call => call.mutation === true).length, 0);
});
