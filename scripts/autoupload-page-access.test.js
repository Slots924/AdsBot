import test from "node:test";
import assert from "node:assert/strict";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import FacebookPasswordEncryption from "../facebook/autoupload/encryption/FacebookPasswordEncryption.js";
import grantFanPageAccess from "../facebook/autoupload/workflows/grantFanPageAccess.js";
import HttpPageActionContext from "../facebook/autoupload/HttpPageActionContext.js";
import grantProfileFanPageAccess from "../workflows/autoupload/grantProfileFanPageAccess.js";

const accountId = "100", pageId = "200", targetUserId = "300";
const scriptUrl = "https://static.xx.fbcdn.net/rsrc.php/v4/y/r/encryption.js";
const script = '__d("EnvelopeEncryption",[],function(a,b,c,d,e,f,g){g.encrypt=async function(){return "c2VjcmV0";};}); __d("FBBrowserPasswordEncryption",["EnvelopeEncryption"],function(a,b,c,d,e,f,g){g.encryptPassword=async function(k,p,password,time){return "#PWD_BROWSER:5:"+time+":"+await c("EnvelopeEncryption").encrypt();};});';
const response = (data, headers = {}, status = 200) => ({ data: typeof data === "string" ? data : JSON.stringify(data), headers, status });

function fixture(options = {}) {
    const calls = [];
    let pending = options.pending === true, reads = 0;
    const client = new FacebookWebClient({ userAgent: "Test-UA", cookies: [
        { name: "c_user", value: accountId, domain: ".facebook.com", path: "/", secure: true },
        { name: "xs", value: "private-cookie", domain: ".facebook.com", path: "/", secure: true },
        ...(options.onPage ? [{ name: "i_user", value: pageId, domain: ".facebook.com", path: "/", secure: true }] : []),
    ], httpClient: { request: async (config, transportOptions) => {
        calls.push({ config, transportOptions });
        if (config.url === scriptUrl) return response(options.script ?? script);
        if (config.method === "get") {
            const actor = /i_user=200/.test(config.headers.Cookie) ? pageId : accountId;
            return response(`DTSGInitialData",[],{"token":"private-dtsg"} LSD",[],{"token":"private-lsd"} <input name="jazoest" value="2123"> {"ACCOUNT_ID":"${options.wrongOwner ? "999" : accountId}","actorID":"${actor}","sessionId":"private-session","client_revision":456,"__spin_r":456,"__spin_b":"trunk","__spin_t":789,"comet_env":15}<script src="${scriptUrl}"></script>`);
        }
        const form = new URLSearchParams(config.data);
        const operation = form.get("fb_api_req_friendly_name");
        const variables = JSON.parse(form.get("variables"));
        if (operation === "CometProfileSwitchMutation") {
            assert.equal(variables.profile_id, pageId);
            if (options.switchTimeout) throw Object.assign(new Error("timeout"), { code: "ECONNRESET" });
            return response({ data: { profile_switch: { id: pageId } } }, options.switchFails ? {} : { "set-cookie": [`i_user=${pageId}; Domain=.facebook.com; Path=/; Secure`] });
        }
        assert.equal(form.get("av"), pageId);
        assert.equal(form.get("__user"), pageId);
        if (operation === "CometProfilePlusAdminPermissionsRootQuery") {
            reads++;
            if (reads > 1 && options.verifyFails) return response("not json");
            return response({ data: { viewer: { actor: {
                id: options.wrongPage ? "999" : pageId, name: "Test page",
                outgoing_core_app_admin_invites: { nodes: pending ? [{ invitee: { id: targetUserId } }] : [] },
                full_control_users: options.fullControl ? [{ id: targetUserId }] : [],
                public_key_and_id_for_encryption: options.noKeys ? null : { key_id: 1, public_key: "ab".repeat(32) },
            } } } });
        }
        assert.equal(variables.input.actor_id, pageId);
        if (operation === "ProfilePlusMarkReauthedMutation") {
            assert.match(variables.input.password.sensitive_string_value, /^#PWD_BROWSER:/);
            assert.ok(!config.data.includes("private-password"));
            return response({ data: { admin_management_mark_reauthed: { reauth_is_successful: !options.reauthFails } } });
        }
        if (operation === "ProfilePlusCoreAppAdminInviteMutation") {
            assert.equal(variables.input.admin_id, targetUserId);
            assert.equal(variables.input.additional_profile_id, pageId);
            assert.equal(variables.input.grant_full_control, true);
            if (options.inviteError) return response({ errors: [{ code: 1675030, message: "private-password private-dtsg" }] });
            if (options.partialError) return response({ data: { profile_plus_core_admin_invite: { is_invite_sent: true } }, errors: [{ code: 123, message: "Partial error" }] });
            if (options.inviteTimeout) {
                if (options.acceptedBeforeTimeout) pending = true;
                throw Object.assign(new Error("private-password"), { code: "ECONNRESET" });
            }
            if (options.inviteMalformed) return response("not json");
            if (options.inviteNotConfirmed) return response({ data: { profile_plus_core_admin_invite: { is_invite_sent: false } } });
            pending = true;
            return response({ data: { profile_plus_core_admin_invite: { is_invite_sent: true } } });
        }
        throw new Error("Невідома тестова операція");
    } } });
    const count = name => calls.filter(({ config }) => config.data && new URLSearchParams(config.data).get("fb_api_req_friendly_name") === name).length;
    return { client, calls, count };
}

const run = (value, options = {}) => grantFanPageAccess(value.client, {
    additionalProfileId: pageId, targetUserId, password: "private-password", ...options,
});

test("повний HTTP-flow перемикає actor, завантажує модуль і надсилає один підтверджений інвайт", async () => {
    const value = fixture();
    const result = await run(value);
    assert.equal(result.success, true);
    assert.equal(result.outcome, "INVITE_SENT");
    assert.equal(result.inviteSent, true);
    assert.equal(result.invitePending, true);
    assert.equal(result.verified, true);
    assert.equal(value.count("CometProfileSwitchMutation"), 1);
    assert.equal(value.count("ProfilePlusMarkReauthedMutation"), 1);
    assert.equal(value.count("ProfilePlusCoreAppAdminInviteMutation"), 1);
    assert.equal(value.client.getFbData("p1").actorId, pageId);
    for (const { config, transportOptions } of value.calls) {
        if (config.method === "post") assert.equal(transportOptions.retryOnConnectionError, !new URLSearchParams(config.data).get("fb_api_req_friendly_name").endsWith("Mutation"));
        if (config.url === scriptUrl) {
            assert.equal(config.headers.Cookie, undefined);
            assert.equal(config.headers["X-FB-LSD"], undefined);
        }
    }
    for (const secret of ["private-cookie", "private-password", "private-dtsg", "private-session", "#PWD_BROWSER"]) assert.ok(!JSON.stringify(result).includes(secret));
});

test("поточна фанка не потребує mutation перемикання", async () => {
    const value = fixture({ onPage: true });
    assert.equal((await run(value)).success, true);
    assert.equal(value.count("CometProfileSwitchMutation"), 0);
});

test("наявний інвайт або повний доступ пропускає пароль і всі mutation", async () => {
    for (const state of [{ pending: true }, { fullControl: true }]) {
        const value = fixture({ onPage: true, ...state });
        const result = await run(value, { password: undefined });
        assert.equal(result.success, true);
        assert.equal(result.inviteSent, false);
        assert.equal(result.outcome, state.pending ? "INVITE_ALREADY_PENDING" : "FULL_CONTROL_ALREADY_PRESENT");
        assert.equal(value.calls.filter(({ config }) => config.method === "post").length, 1);
        assert.equal(value.calls.some(({ config }) => config.url === scriptUrl), false);
    }
});

test("таймаут інвайту не повторює POST, контрольне читання може підтвердити прийнятий запис", async () => {
    for (const acceptedBeforeTimeout of [false, true]) {
        const value = fixture({ inviteTimeout: true, acceptedBeforeTimeout });
        const result = await run(value);
        assert.equal(value.count("ProfilePlusCoreAppAdminInviteMutation"), 1);
        assert.equal(result.success, acceptedBeforeTimeout);
        assert.equal(result.outcomeUnknown, !acceptedBeforeTimeout);
        if (acceptedBeforeTimeout) assert.equal(result.invitePending, true);
    }
});

test("GraphQL-помилка, некоректна відповідь та непідтверджений інвайт не розкривають секретів і не повторюють запис", async () => {
    for (const state of [{ inviteError: true }, { inviteMalformed: true }, { inviteNotConfirmed: true }, { partialError: true }]) {
        const value = fixture(state);
        const result = await run(value);
        assert.equal(result.success, false);
        assert.equal(value.count("ProfilePlusCoreAppAdminInviteMutation"), 1);
        assert.equal(result.outcomeUnknown, !state.inviteError);
        assert.ok(!JSON.stringify(result).includes("private-password"));
        assert.ok(!JSON.stringify(result).includes("private-dtsg"));
        if (state.inviteError) assert.equal(result.graphCode, 1675030);
    }
});

test("збій перемикання інвалідує стару сесію та не надсилає наступних mutation", async () => {
    const value = fixture({ switchTimeout: true });
    const result = await run(value);
    assert.equal(result.success, false);
    assert.equal(result.outcomeUnknown, true);
    assert.equal(value.count("CometProfileSwitchMutation"), 1);
    assert.equal(value.count("ProfilePlusMarkReauthedMutation"), 0);
    assert.throws(() => value.client.getFbData("p1"));
});

test("скасування контрольного читання зберігає підтверджений результат інвайту", async () => {
    const controller = new AbortController();
    const result = await run(fixture(), { signal: controller.signal, onStage: stage => {
        if (stage === "VERIFY") controller.abort();
    } });
    assert.equal(result.success, true);
    assert.equal(result.inviteSent, true);
    assert.equal(result.verified, false);
});

test("зовнішній workflow перевіряє параметри до AdsPower й не розкриває помилки з секретами", async () => {
    const result = await grantProfileFanPageAccess({ profileNo: "1", profileId: "p1", additionalProfileId: pageId, targetUserId });
    assert.equal(result.code, "FACEBOOK_ACCESS_INPUT_INVALID");
    const failed = await grantProfileFanPageAccess({ profileNo: "1", additionalProfileId: pageId, targetUserId,
        adsPower: { getProfileByNo: async () => { throw new Error("private-password"); } },
    });
    assert.equal(failed.code, "ADSPOWER_PROFILE_PREPARATION_FAILED");
    assert.ok(!JSON.stringify(failed).includes("private-password"));
});

test("збій контрольного читання не скасовує підтверджене надсилання", async () => {
    const result = await run(fixture({ verifyFails: true }));
    assert.equal(result.success, true);
    assert.equal(result.inviteSent, true);
    assert.equal(result.verified, false);
    assert.equal(result.invitePending, null);
});

test("помилки власника, actor, ключа, пароля й reauth зупиняють інвайт", async () => {
    for (const state of [{ wrongOwner: true }, { wrongPage: true }, { switchFails: true }, { noKeys: true }, { reauthFails: true }]) {
        const value = fixture(state);
        assert.equal((await run(value)).success, false);
        assert.equal(value.count("ProfilePlusCoreAppAdminInviteMutation"), 0);
    }
    const value = fixture();
    assert.equal((await run(value, { password: "" })).code, "FACEBOOK_PASSWORD_REQUIRED");
    assert.equal(value.count("ProfilePlusMarkReauthedMutation"), 0);
});

test("скасування та некоректні ID не надсилають запитів", async () => {
    const value = fixture();
    const controller = new AbortController(); controller.abort();
    assert.equal((await run(value, { signal: controller.signal })).code, "TASK_INTERRUPTED");
    assert.equal((await run(value, { targetUserId: "invalid" })).code, "FACEBOOK_ACCESS_INPUT_INVALID");
    assert.equal(value.calls.length, 0);
});

test("модуль шифрування кешується лише в пам'яті та потребує повного дерева залежностей", async () => {
    const value = fixture();
    const encryption = new FacebookPasswordEncryption(value.client);
    const input = { keyId: 1, publicKey: "ab".repeat(32), password: "private-password", scriptUrls: [scriptUrl] };
    assert.match(await encryption.encrypt(input), /^#PWD_BROWSER:5:/);
    await encryption.encrypt(input);
    assert.equal(value.calls.length, 1);
    const incomplete = fixture({ script: '__d("FBBrowserPasswordEncryption",["MissingDependency"],function(){});' });
    await assert.rejects(new FacebookPasswordEncryption(incomplete.client).encrypt(input), error => error.code === "FACEBOOK_ENCRYPTION_MODULE_UNAVAILABLE");
    await assert.rejects(encryption.encrypt({ ...input, keyId: null }), error => error.code === "FACEBOOK_ENCRYPTION_INPUT_INVALID");
});

test("CDN-клієнт відхиляє сторонні адреси, контекст відхиляє сторонні операції", async () => {
    const value = fixture();
    for (const url of ["https://example.com/x.js", "http://static.xx.fbcdn.net/rsrc.php/a.js", "https://static.xx.fbcdn.net/other.js"]) {
        await assert.rejects(value.client.requestStaticResource(url), error => error.code === "FACEBOOK_RESOURCE_INVALID");
    }
    const context = new HttpPageActionContext(value.client);
    await assert.rejects(context.postForm({ friendlyName: "UnknownMutation", body: "" }), error => error.code === "FACEBOOK_ENDPOINT_INVALID");
    assert.equal(value.calls.length, 0);
});
