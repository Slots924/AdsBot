import assert from "node:assert/strict";
import test from "node:test";
import { BAN_TAG_ID, LOGIN_ERROR_TAG_ID, CHANGE_NAME_ERROR_TAG_ID } from "../config.js";
import checkProfileHealth from "../services/profile/checkProfileHealth.js";
import checkProfileBeforeLaunch from "../workflows/profile/checkProfileBeforeLaunch.js";
import checkFacebookAfterLaunch from "../workflows/profile/checkFacebookAfterLaunch.js";

const profile = { profile_no: "1", profile_tags: [] };
const allChecks = { loggedIn: true, active: true, ensureEnglish: true };

function facebookActions({ login = true, active = true, english = true } = {}) {
    const calls = [];
    return {
        calls,
        actions: {
            ensureLoggedIn: async () => { calls.push("login"); return login; },
            ensureActive: async () => { calls.push("active"); return active; },
            ensureEnglish: async () => { calls.push("english"); return english; },
        },
    };
}

test("Заборонені теги зупиняють запуск до перевірки проксі та AdsPower", async () => {
    for (const [tag, id] of [["BAN", BAN_TAG_ID], ["LOGIN_ERROR", LOGIN_ERROR_TAG_ID], ["CHANGE_NAME_ERROR", CHANGE_NAME_ERROR_TAG_ID]]) {
        const result = await checkProfileBeforeLaunch({
            profile: { ...profile, profile_tags: [{ id }] },
            checks: { adsPowerReady: true, blockedTags: [tag] },
            actions: { ensureAdsPowerReady: () => assert.fail("AdsPower не повинен викликатися") },
        });
        assert.equal(result.ok, false);
        assert.equal(result.blockedTag, tag);
        assert.equal(result.adsPowerReady, null);
    }
});

test("Теги та готовність AdsPower вмикаються незалежно", async () => {
    const tagged = { ...profile, profile_tags: [{ id: BAN_TAG_ID }] };
    assert.equal((await checkProfileBeforeLaunch({
        profile: tagged, checks: { adsPowerReady: false, blockedTags: [] },
    })).ok, true);
    let calls = 0;
    const result = await checkProfileBeforeLaunch({
        profile: tagged, checks: { adsPowerReady: true, blockedTags: [] },
        actions: { ensureAdsPowerReady: async (adsPower, received, options) => {
            calls++;
            assert.equal(received, tagged);
            assert.deepEqual(options.blockedTags, []);
            return false;
        } },
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.blockedTag, null);
});

test("Старі виклики checkProfileHealth зберігають блокування BAN та Login Error", async () => {
    for (const [id, status] of [[BAN_TAG_ID, "BANNED"], [LOGIN_ERROR_TAG_ID, "LOGIN_ERROR"]]) {
        assert.equal(await checkProfileHealth(null, { profile_tags: [{ id }] }), status);
    }
});

test("Вимкнений ensureEnglish не викликається, вхід та активність перевіряються", async () => {
    const { actions, calls } = facebookActions();
    const result = await checkFacebookAfterLaunch({
        profile, actions, checks: { ...allChecks, ensureEnglish: false },
    });
    assert.deepEqual(calls, ["login", "active"]);
    assert.deepEqual(result, { ok: true, failedCheck: null, login: true, active: true, english: null });
});

test("Кожну Facebook-перевірку можна вимкнути незалежно", async () => {
    const { actions, calls } = facebookActions();
    const result = await checkFacebookAfterLaunch({
        actions, checks: { loggedIn: false, active: false, ensureEnglish: true },
    });
    assert.deepEqual(calls, ["english"]);
    assert.equal(result.login, null);
    assert.equal(result.active, null);
    assert.equal(result.ok, true);
});

test("Невдалий вхід чи неактивність зупиняють наступні перевірки", async () => {
    for (const [options, expected, failedCheck] of [
        [{ login: false }, ["login"], "loggedIn"],
        [{ active: false }, ["login", "active"], "active"],
    ]) {
        const { actions, calls } = facebookActions(options);
        const result = await checkFacebookAfterLaunch({ actions, checks: allChecks });
        assert.deepEqual(calls, expected);
        assert.equal(result.ok, false);
        assert.equal(result.failedCheck, failedCheck);
        assert.equal(result.english, null);
    }
});

test("Політика зміни мови зберігає обов'язковий та необов'язковий режими", async () => {
    for (const englishFailure of ["stop", "continue"]) {
        const { actions, calls } = facebookActions({ english: false });
        const result = await checkFacebookAfterLaunch({ actions, checks: allChecks, englishFailure });
        assert.deepEqual(calls, ["login", "active", "english"]);
        assert.equal(result.english, false);
        assert.equal(result.ok, englishFailure === "continue");
        assert.equal(result.failedCheck, englishFailure === "stop" ? "ensureEnglish" : null);
    }
});

test("Етапи та часткові результати доступні для журналу до помилки", async () => {
    const events = [];
    const { actions } = facebookActions();
    actions.ensureEnglish = async () => { throw new Error("language failed"); };
    await assert.rejects(checkFacebookAfterLaunch({
        actions, checks: allChecks,
        onCheck: (check) => events.push(check),
        onResult: (field, passed) => events.push([field, passed]),
    }), /language failed/);
    assert.deepEqual(events, ["loggedIn", ["login", true], "active", ["active", true], "ensureEnglish"]);
});

test("Скасування між перевірками зупиняє наступні дії", async () => {
    const controller = new AbortController();
    const { actions, calls } = facebookActions();
    const originalLogin = actions.ensureLoggedIn;
    actions.ensureLoggedIn = async () => { controller.abort(); return originalLogin(); };
    await assert.rejects(checkFacebookAfterLaunch({ actions, checks: allChecks, signal: controller.signal }), { name: "AbortError" });
    assert.deepEqual(calls, ["login"]);
});

test("Пропущені параметри та невідомі теги не вимикають перевірки мовчки", async () => {
    await assert.rejects(checkFacebookAfterLaunch({ checks: { loggedIn: true } }), /checks.active/);
    await assert.rejects(checkProfileBeforeLaunch({ checks: { blockedTags: [] } }), /checks.adsPowerReady/);
    await assert.rejects(checkProfileBeforeLaunch({ checks: { adsPowerReady: false, blockedTags: ["TYPO"] } }), /тегів/);
});
