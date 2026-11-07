import test from "node:test";
import assert from "node:assert/strict";
import ManualCommentSessionManager from "../services/gui/ManualCommentSessionManager.js";
import ProfileActivityStore from "../services/profile/ProfileActivityStore.js";
import { BAN_TAG_ID, LOGIN_ERROR_TAG_ID, MAN_TAG_ID, WOMAN_TAG_ID } from "../config.js";

const comment = (id, gender = "male", key = null, parent = null) => ({ id, gender, profile_key: key,
    parent_id: parent, is_author: false, should_write: true, text: `Коментар ${id}` });

async function fixture(t, comments) {
    const activityStore = new ProfileActivityStore({ databaseFile: ":memory:" });
    await activityStore.initialize();
    t.after(() => activityStore.db.close());
    const profiles = [
        ["1", [MAN_TAG_ID]], ["2", [MAN_TAG_ID]], ["3", [WOMAN_TAG_ID]],
        ["4", [MAN_TAG_ID, BAN_TAG_ID]], ["5", [WOMAN_TAG_ID, LOGIN_ERROR_TAG_ID]],
        ["6", []], ["7", [MAN_TAG_ID, WOMAN_TAG_ID]], ["8", [MAN_TAG_ID]],
    ].map(([no, tags]) => ({ profile_no: no, profile_id: `id-${no}`, name: `Акаунт ${no}`,
        group_id: "g", group_name: "Група", profile_tags: tags.map((id) => ({ id })) }));
    const events = [];
    const opened = new Set();
    let failOpen = false;
    let failCopy = false;
    const guiService = {
        adsPower: {
            getProfilesByGroupId: async () => profiles,
            getProfileByNo: async (no) => profiles.find((profile) => profile.profile_no === no),
            getCloudProfileStatus: async () => [...opened].map((no) => ({ user_id: `id-${no}` })),
        },
        openAdsPowerProfile: async (no, options) => {
            assert.equal(options.windowSize.width, 1280);
            assert.equal(options.windowSize.height, 1440);
            events.push(["open", no]);
            if (failOpen) throw new Error("Помилка запуску");
            opened.add(no);
        },
        closeAdsPowerProfile: async (no) => { events.push(["close", no]); opened.delete(no); },
    };
    const options = { guiService, activityStore,
        copyText: async (text) => { if (failCopy) throw new Error("Буфер недоступний"); events.push(["copy", text]); },
        creativeManager: { getCreative: async () => ({ comments }) },
        markBanned: async (_ads, profile) => { events.push(["ban", profile.profile_no]); profile.profile_tags.push({ id: BAN_TAG_ID }); },
    };
    const manager = new ManualCommentSessionManager(options);
    const session = await manager.execute("start", { contextKey: "page-post", geo: "US", creativeName: "202", groupIds: ["g", "g2"] });
    const act = (action, commentId) => manager.execute(action, { sessionId: session.id, commentId });
    return { manager, options, session, act, activityStore, profiles, events, opened, guiService,
        failOpen: (value) => { failOpen = value; }, failCopy: (value) => { failCopy = value; } };
}

test("пул фільтрує теги й дублікати; автор недоступний; стать відповідає коментарю", async (t) => {
    const f = await fixture(t, [comment("1", "female"), { ...comment("2"), is_author: true }]);
    assert.deepEqual(f.session.pool.map((item) => item.profileNo), ["1", "2", "3", "8"]);
    const state = await f.act("open", "1");
    assert.equal(state.comments[0].profileNo, "3");
    assert.deepEqual(f.events.at(-1), ["copy", "Коментар 1"]);
    await assert.rejects(f.act("open", "2"), /недоступний/);
    assert.equal((await f.activityStore.list({ bannedOnly: false })).items.length, 0);
});

test("заміна скасовує попередню спробу, закриває профіль і повторює копіювання", async (t) => {
    const f = await fixture(t, [comment("1")]);
    await f.act("open", "1");
    const replaced = await f.act("replace", "1");
    assert.equal(replaced.comments[0].profileNo, "2");
    assert.equal(replaced.pool[0].state, "replaced");
    assert.ok(f.events.some(([action, no]) => action === "close" && no === "1"));
    assert.deepEqual(f.events.at(-1), ["copy", "Коментар 1"]);
    await f.act("finish");
    const stats = await f.activityStore.list({ bannedOnly: false });
    assert.deepEqual(stats.items.map((item) => [item.profileNo, item.manualCommentCount]), [["2", 1]]);
});

for (const action of ["replace", "ban"]) {
    test(`${action}: закриття не залежить від порожнього або недоступного хмарного статусу`, async (t) => {
        for (const status of ["empty", "error"]) {
            const f = await fixture(t, [comment("1")]);
            await f.act("open", "1");
            let statusCalls = 0;
            f.guiService.adsPower.getCloudProfileStatus = async () => {
                statusCalls++;
                if (status === "error") throw new Error("Статус недоступний");
                return [];
            };
            f.events.length = 0;
            const state = await f.act(action, "1");
            assert.deepEqual(f.events[0], ["close", "1"]);
            assert.equal(statusCalls, 0);
            assert.equal(state.comments[0].profileNo, "2");
            assert.equal(f.opened.has("1"), false);
        }
    });

    test(`${action}: помилка буфера не перешкоджає спробі закриття`, async (t) => {
        const f = await fixture(t, [comment("1")]);
        await f.act("open", "1");
        f.failCopy(true);
        await assert.rejects(f.act(action, "1"), /Буфер/);
        assert.ok(f.events.some(([event, no]) => event === "close" && no === "1"));
        assert.equal(f.opened.has("1"), false);
        assert.ok(!f.events.some(([event, no]) => event === "open" && no === "2"));
    });
}

test("два чоловіки в діалозі зберігають власні профілі; повторне відкриття не дублює статистику", async (t) => {
    const f = await fixture(t, [comment("1", "male", "a"), comment("2", "male", "b", "1"), comment("3", "male", "a", "2")]);
    await Promise.all([f.act("open", "1"), f.act("open", "2")]);
    await f.act("open", "3");
    await f.act("open", "1");
    await assert.rejects(f.act("replace", "3"), /інші репліки/);
    const restored = new ManualCommentSessionManager(f.options);
    const state = await restored.execute("resume", { contextKey: "page-post" });
    assert.deepEqual(state.comments.map((row) => row.profileNo), ["1", "2", "1"]);
    await f.act("finish");
    await restored.execute("finish", { sessionId: state.id });
    const stats = await f.activityStore.list({ bannedOnly: false });
    assert.equal(stats.items.find((row) => row.profileNo === "1").manualCommentCount, 2);
    assert.equal(stats.items.find((row) => row.profileNo === "2").manualCommentCount, 1);
    assert.equal(stats.items.find((row) => row.profileNo === "1").totalTargetActions, 2);
    assert.equal(await restored.execute("resume", { contextKey: "page-post" }), null);
});

test("бан бере наступного, а в розпочатому діалозі блокує продовження й зберігає старі успіхи", async (t) => {
    const f = await fixture(t, [comment("1", "male", "a"), comment("2", "male", "a", "1"), comment("3", "male", "a", "2")]);
    await f.act("open", "1");
    const afterFirstBan = await f.act("ban", "1");
    assert.equal(afterFirstBan.comments[0].profileNo, "2");
    assert.ok(f.events.some(([action, no]) => action === "ban" && no === "1"));
    await f.act("open", "2");
    const state = await f.act("ban", "2");
    assert.equal(state.comments[0].status, "assumed");
    assert.equal(state.comments[1].status, "blocked");
    const blocked = await f.act("open", "3");
    assert.equal(blocked.comments[2].status, "blocked");
    assert.ok(!f.events.some(([action, no]) => action === "open" && no === "8"));
    await f.act("finish");
    const stats = await f.activityStore.list({ bannedOnly: false });
    assert.equal(stats.items.find((row) => row.profileNo === "2").manualCommentCount, 1);
});

test("помилки запуску й копіювання не зараховуються; скасовані коментарі також", async (t) => {
    const f = await fixture(t, [comment("1"), comment("2", "female")]);
    f.failOpen(true);
    await assert.rejects(f.act("open", "1"), /запуску/);
    f.failOpen(false);
    f.failCopy(true);
    await assert.rejects(f.act("open", "1"), /Буфер/);
    f.failCopy(false);
    await f.act("open", "2");
    await f.act("undo", "2");
    await f.act("finish");
    assert.equal((await f.activityStore.list({ bannedOnly: false })).items.length, 0);
});

test("теги перевіряються перед запуском; порожній пул дозволений", async (t) => {
    const f = await fixture(t, [comment("1", "female")]);
    f.profiles.find((profile) => profile.profile_no === "3").profile_tags.push({ id: LOGIN_ERROR_TAG_ID });
    await assert.rejects(f.act("open", "1"), /немає доступного/);
    assert.equal(f.events.length, 0);
    const state = await f.act("get");
    assert.equal(state.pool.find((profile) => profile.profileNo === "3").state, "unavailable");
});

test("помилка закриття під час заміни не зараховує невдалий коментар", async (t) => {
    const f = await fixture(t, [comment("1")]);
    await f.act("open", "1");
    f.guiService.closeAdsPowerProfile = async () => { throw new Error("Не закрився"); };
    await assert.rejects(f.act("replace", "1"), /Не закрився/);
    await f.act("finish");
    assert.equal((await f.activityStore.list({ bannedOnly: false })).items.length, 0);
});

test("повторне завершення після часткового збою не дублює успіхи й блокує редагування", async (t) => {
    const f = await fixture(t, [comment("1"), comment("2")]);
    await f.act("open", "1");
    await f.act("open", "2");
    const original = f.activityStore.recordSuccessfulAction.bind(f.activityStore);
    let calls = 0;
    f.activityStore.recordSuccessfulAction = async (input) => {
        if (++calls === 2) throw new Error("Тимчасовий збій статистики");
        return original(input);
    };
    await assert.rejects(f.act("finish"), /Тимчасовий збій/);
    await assert.rejects(f.act("undo", "1"), /Повторіть закриття/);
    await f.act("finish");
    const stats = await f.activityStore.list({ bannedOnly: false });
    assert.equal(stats.items.reduce((sum, row) => sum + row.manualCommentCount, 0), 2);
});

test("після заміни скасовані репліки того самого учасника не зберігають старий профіль", async (t) => {
    const f = await fixture(t, [comment("1", "male", "a"), comment("2", "male", "a", "1")]);
    await f.act("open", "1");
    await f.act("undo", "1");
    await f.act("open", "2");
    const replaced = await f.act("replace", "2");
    assert.equal(replaced.comments[0].profileNo, null);
    assert.equal(replaced.assignments.a, "2");
    const reopened = await f.act("open", "1");
    assert.equal(reopened.comments[0].profileNo, "2");
});
