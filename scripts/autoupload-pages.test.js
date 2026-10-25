import test from "node:test";
import assert from "node:assert/strict";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import getFanPages from "../facebook/autoupload/actions/pages/getFanPages.js";
import getFacebookAccountId from "../facebook/session/getFacebookAccountId.js";

const accountId = "123";
const profile = id => ({ id, name: `Profile ${id}`, profile_picture: { uri: `https://example.com/${id}.jpg` } });
const html = (actorId, owner = accountId) => `DTSGInitialData",[],{"token":"secret-dtsg"} LSD",[],{"token":"secret-lsd"} <input name="jazoest" value="2123"> {"ACCOUNT_ID":"${owner}","actorID":"${actorId}","sessionId":"secret-session","client_revision":456}`;
const response = data => ({ status: 200, headers: {}, data: typeof data === "string" ? data : JSON.stringify(data) });

function fixture({ actorId = accountId, owner = accountId, profiles = [], graphql, returnedActorId = actorId } = {}) {
    const calls = [];
    const client = new FacebookWebClient({
        cookies: ["c_user", "xs"].map(name => ({ name, value: name === "c_user" ? accountId : "secret-xs", domain: ".facebook.com", path: "/", secure: true })),
        userAgent: "Test", httpClient: { request: async (config, options) => {
            calls.push({ config, options });
            if (config.method === "get") return response(html(actorId, owner));
            return response(graphql ?? { data: { viewer: { actor: {
                ...profile(returnedActorId), profile_switcher_eligible_profiles: { nodes: profiles.map(value => ({ profile: value })) },
            } } } });
        } },
    });
    return { client, calls };
}

test("власник cookies читається лише з Facebook c_user", () => {
    assert.equal(getFacebookAccountId([{ name: "c_user", domain: "example.com", value: "999" }, { name: "c_user", domain: ".facebook.com", value: accountId }]), accountId);
    assert.equal(getFacebookAccountId([{ name: "i_user", domain: ".facebook.com", value: "456" }]), null);
});

test("соц і фанка повертають однаковий список із назвами та аватарками", async () => {
    const social = fixture({ profiles: [profile("456"), profile("789")] });
    const page = fixture({ actorId: "456", profiles: [profile(accountId), profile("789")] });
    const first = await getFanPages(social.client);
    const second = await getFanPages(page.client);
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal(second.accountId, accountId);
    assert.equal(second.currentActorId, "456");
    assert.deepEqual(first.pages, second.pages.toSorted((a, b) => a.additionalProfileId.localeCompare(b.additionalProfileId)));
    assert.equal(first.count, 2);
    for (const { calls } of [social, page]) {
        assert.equal(calls.length, 2);
        const { config, options } = calls[1];
        const form = new URLSearchParams(config.data);
        assert.equal(form.get("doc_id"), "25679861721687752");
        assert.equal(form.get("av"), form.get("__user"));
        assert.deepEqual(JSON.parse(form.get("variables")), { enable_lar_eligibility_check: true, scale: 1 });
        assert.equal(options.retryOnConnectionError, true);
        assert.equal(config.headers["Sec-Fetch-Mode"], "cors");
    }
    for (const secret of ["secret-xs", "secret-dtsg", "secret-lsd", "secret-session"]) {
        assert.ok(!JSON.stringify([first, second]).includes(secret));
    }
});

test("дублікати прибираються, порожні дані actor не затирають назву й фото", async () => {
    const value = fixture({ actorId: "456", profiles: [profile("456"), profile("456"), profile(accountId)],
        graphql: { data: { viewer: { actor: { id: "456", profile_switcher_eligible_profiles: { nodes: [
            { profile: profile("456") }, { profile: profile("456") }, { profile: profile(accountId) },
        ] } } } } } });
    const result = await getFanPages(value.client);
    assert.deepEqual(result.pages, [{ additionalProfileId: "456", name: "Profile 456", photoUrl: "https://example.com/456.jpg" }]);
});

test("порожній список соца є успіхом, поточна фанка додається до порожнього списку", async () => {
    assert.deepEqual((await getFanPages(fixture().client)).pages, []);
    assert.equal((await getFanPages(fixture({ actorId: "456" }).client)).count, 1);
});

test("чужий власник HTML і зміна actor не повертають успішного списку", async () => {
    const wrongOwner = fixture({ owner: "999" });
    assert.equal((await getFanPages(wrongOwner.client)).code, "FACEBOOK_SESSION_MISMATCH");
    assert.equal(wrongOwner.calls.length, 1);
    assert.equal((await getFanPages(fixture({ returnedActorId: "999" }).client)).code, "FACEBOOK_SESSION_MISMATCH");
});

test("помилки GraphQL, зокрема data.errors, та відсутній список не маскуються під порожній успіх", async () => {
    for (const graphql of [{ errors: [{ code: 190, message: "Authentication required" }] }, { data: { errors: [{ code: 190, message: "Authentication required" }] } }]) {
        const result = await getFanPages(fixture({ graphql }).client);
        assert.equal(result.success, false);
        assert.equal(result.code, "FACEBOOK_GRAPHQL_ERROR");
        assert.equal(result.sessionStatus, "login_required");
    }
    assert.equal((await getFanPages(fixture({ graphql: { data: { viewer: { actor: profile(accountId) } } } }).client)).success, false);
});

test("скасування не надсилає запитів, читання actor не послаблює перевірку соціальної сесії", async () => {
    const value = fixture();
    const controller = new AbortController();
    controller.abort();
    assert.equal((await getFanPages(value.client, { signal: controller.signal })).success, false);
    assert.equal(value.calls.length, 0);
    const page = fixture({ actorId: "456" });
    assert.equal((await getFanPages(page.client)).success, true);
    await assert.rejects(() => page.client.checkSession(), /інший акаунт/);
});
