import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import ProfileActivityStore, { profileActivityTypes } from "../services/profile/ProfileActivityStore.js";
import { normalizeFarmSettings, normalizeFacebookGroup } from "../services/farming/farmSettings.js";
import executeFarmWithProfile from "../workflows/profile/executeFarmWithProfile.js";
import runFarmScenario from "../scenarios/runFarmScenario.js";
import FarmService from "../services/farming/FarmService.js";
import registerFarmIpcHandlers from "../frontend/electron/registerFarmIpcHandlers.js";
import { shuffleFarmItems } from "../facebook/actions/runFarmActions.js";
import AdsPower from "../classes/AdsPower.js";
import axios from "axios";

async function fixture() {
    const activity = new ProfileActivityStore({ databaseFile: ":memory:" });
    await activity.initialize();
    const store = activity.farm;
    const a = await store.saveGroup({ name: "A", notes: "Абзац 1\n\nАбзац 2" });
    const b = await store.saveGroup({ name: "B" });
    const members = [1, 2, 3].map((no) => ({ profileNo: String(no), profileId: `id-${no}`, name: `Тест ${no}` }));
    await store.assign(a.id, members);
    return { activity, store, a, b, members, close: () => activity.db.close() };
}

test("групи незалежні від AdsPower, перенесення переносить усю статистику; старий журнал не видаляє фарм", async () => {
    const f = await fixture();
    try {
        await f.activity.recordSuccessfulAction({ profileNo: "1", actionType: profileActivityTypes.COMMENT_TASK });
        await f.activity.markBanned("1");
        const run = await f.store.createRun(f.a.id, f.members, normalizeFarmSettings(), []);
        for (const [id, start, end] of [["s1", "2026-10-01T10:00:00Z", "2026-10-01T10:01:00Z"], ["s2", "2026-10-03T10:00:00Z", "2026-10-03T10:02:00Z"]]) {
            await f.store.saveSession({ id, runId: run.id, profileNo: "1", farmStartedAt: start, farmFinishedAt: end,
                farmTimeMs: Date.parse(end) - Date.parse(start), outcome: "completed" });
        }
        await f.store.saveSession({ id: "s3", runId: run.id, profileNo: "1", farmTimeMs: 0, outcome: "check_failed" });
        let member = (await f.store.members(f.a.id))[0];
        assert.equal(member.farmSessionCount, 2);
        assert.equal(member.farmTimeMs, 180000);
        assert.equal(member.farmPeriodMs, 172920000);
        assert.equal(member.outcomes.check_failed, 1);
        await f.store.assign(f.b.id, [f.members[0]]);
        const groups = await f.store.groups();
        assert.equal(groups.find((g) => g.id === f.a.id).totals.commentTaskCount, 0);
        assert.equal(groups.find((g) => g.id === f.b.id).totals.commentTaskCount, 1);
        assert.equal(groups.find((g) => g.id === f.b.id).bannedPercent, 100);
        assert.equal((await f.store.history(f.a.id)).runs[0].id, run.id);
        assert.equal((await f.store.history(f.b.id)).memberships[0].from_group, f.a.id);
        assert.equal(groups.find((g) => g.id === f.a.id).notes, "Абзац 1\n\nАбзац 2");
        await f.activity.remove(["1"]);
        member = (await f.store.members(f.b.id))[0];
        assert.equal(member.farmTimeMs, 180000);
        await f.store.deleteGroup(f.a.id);
        assert.equal((await f.store.members(f.a.id)).length, 0);
        assert.equal((await f.store.history(f.a.id)).runs.length, 1);
        assert.equal((await f.store.groups()).length, 1);
    } finally { f.close(); }
});

test("налаштування та пул валідуються, кандидати вимкнені, повторна міграція зберігає дані", async () => {
    const f = await fixture();
    try {
        assert((await f.store.pool()).every((group) => !group.enabled && !group.checkedAt));
        assert.throws(() => normalizeFarmSettings({ workers: 6 }));
        assert.throws(() => normalizeFarmSettings({ actions: { feed: { minSeconds: 10, maxSeconds: 1 } } }));
        assert.throws(() => normalizeFacebookGroup({ name: "x", url: "https://example.com/groups/a" }));
        const settings = await f.store.saveSettings({ workers: 2, timeoutSeconds: 500 });
        assert.equal(settings.workers, 2);
        await f.store.savePool([]);
        await f.activity.syncProfileGroups([{ profile_no: "1", profile_id: "id-1", name: "Оновлена", group_id: "ads-new", group_name: "Нова AdsPower" }]);
        assert.equal((await f.store.members(f.a.id))[0].name, "Оновлена");
        assert.equal((await f.store.members(f.a.id))[0].adsPowerGroupId, "ads-new");
        f.store.initialize();
        assert.equal((await f.store.pool()).length, 0);
        assert.equal((await f.store.settings()).workers, 2);
        await f.activity.recordSuccessfulAction({ profileNo: "1", actionType: profileActivityTypes.COMMENT_ACCOUNT_SETUP_API });
        f.store.initialize();
        assert.equal((await f.store.members(f.a.id))[0].setupApiCount, 1);
        await assert.rejects(f.store.savePool([{ name: "a", url: "https://www.facebook.com/groups/a" }, { name: "b", url: "https://facebook.com/groups/a/" }]), /повторні/);
    } finally { f.close(); }
});

test("після перезапуску сесії перервані, час не добудовується", async () => {
    const f = await fixture();
    try {
        const run = await f.store.createRun(f.a.id, f.members, normalizeFarmSettings(), []);
        await f.store.saveSession({ id: "crash", runId: run.id, profileNo: "1", outcome: "running", events: [],
            startedAt: "2026-10-01T09:59:00Z", farmStartedAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:10Z", farmTimeMs: 10000 });
        await f.store.recoverInterrupted();
        const history = await f.store.history(f.a.id);
        assert.equal(history.runs[0].outcome, "interrupted");
        assert.equal(history.runs[0].sessions[0].outcome, "interrupted");
        assert.equal((await f.store.members(f.a.id))[0].farmTimeMs, 10000);
    } finally { f.close(); }
});

function browserFixture(overrides = {}) {
    const calls = [];
    const profile = { profile_no: "1", profile_id: "id-1" };
    const page = { goto: async () => calls.push("goto") };
    const browser = { pages: async () => [page], close: async () => calls.push("browser-close"), disconnect: () => calls.push("disconnect") };
    const adsPower = {
        openProfile: async (_no, options) => { calls.push(["open", options]); return { ws: { puppeteer: "ws://mock" } }; },
        closeProfile: async () => calls.push("profile-close"),
    };
    const dependencies = { isOpen: async () => false, ready: async () => ({ ok: true }), connect: async () => browser,
        configure: async () => calls.push("configure"), check: async () => ({ ok: true }), actions: async () => calls.push("actions"),
        timeoutMs: 100, cleanupMs: 20, ...overrides };
    return { profile, page, browser, adsPower, dependencies, calls };
}
const runBrowser = (f, extra = {}) => executeFarmWithProfile({ ...f, settings: normalizeFarmSettings(), pool: [], ...extra });

test("запуск з проксі профілю, перевірками, без відновлення вкладок; завершення раніше таймауту", async () => {
    const f = browserFixture();
    const result = await runBrowser(f);
    assert.equal(result.outcome, "completed");
    const options = f.calls.find((c) => Array.isArray(c))[1];
    assert.equal(options.proxyDetection, true); assert.equal(options.restoreLastOpenedTabs, false);
    assert.equal(options.disableImages, false); assert.equal(options.browserMode, "visible");
    assert(!("workerProxy" in options));
    assert(result.farmStartedAt); assert(f.calls.includes("profile-close"));
});

test("невдала перевірка або відкритий профіль не запускає фарм", async () => {
    const f = browserFixture({ check: async () => ({ ok: false, failedCheck: "loggedIn" }) });
    const result = await runBrowser(f);
    assert.equal(result.outcome, "check_failed"); assert.equal(result.farmTimeMs, 0); assert(!f.calls.includes("actions"));
    const open = browserFixture({ isOpen: async () => true });
    assert.equal((await runBrowser(open)).outcome, "skipped"); assert.equal(open.calls.length, 0);
});

for (const stage of ["open", "check", "actions"]) test(`таймаут під час ${stage} припиняє браузер і обмежує очищення`, async () => {
    let resolvePending;
    const pending = new Promise((resolve) => { resolvePending = resolve; });
    const f = browserFixture({ timeoutMs: 15, ...(stage !== "open" ? { [stage]: () => pending } : {}) });
    if (stage === "open") f.adsPower.openProfile = () => pending;
    f.adsPower.closeProfile = () => new Promise(() => {});
    const before = Date.now();
    const result = await runBrowser(f);
    assert.equal(result.outcome, "timeout"); assert(Date.now() - before < 1000); assert(result.cleanupError);
    assert.equal(Boolean(result.farmStartedAt), stage === "actions");
    if (stage !== "open") assert(f.calls.includes("browser-close"));
    resolvePending(stage === "open" ? { ws: { puppeteer: "ws://late" } } : { ok: true });
    await sleep(30);
    assert(!f.calls.includes("actions"));
});

test("скасування закриває браузер", async () => {
    const controller = new AbortController();
    const f = browserFixture({ actions: async () => { controller.abort(); await sleep(10); } });
    const result = await runBrowser(f, { signal: controller.signal });
    assert.equal(result.outcome, "cancelled"); assert(f.calls.includes("browser-close"));
});

for (const workers of [1, 2]) test(`${workers} воркери обмежують паралельність та беруть наступний акаунт після таймауту`, async () => {
    const f = await fixture();
    let active = 0; let maximum = 0;
    try {
        const result = await runFarmScenario({ adsPower: { getProfileByNo: async (no) => ({ profile_no: no, profile_id: `id-${no}` }) },
            store: f.store, groupId: f.a.id, members: f.members, settings: normalizeFarmSettings({ workers }), pool: [],
            execute: async ({ onFarmStart, profile }) => {
                active++; maximum = Math.max(maximum, active);
                await onFarmStart(new Date().toISOString()); await sleep(15); active--;
                return { outcome: profile.profile_no === "1" ? "timeout" : "completed", farmTimeMs: 15, farmFinishedAt: new Date().toISOString() };
            } });
        assert.equal(result.sessions.length, 3); assert.equal(maximum, workers);
        assert.equal(result.outcome, "completed_with_warnings");
    } finally { f.close(); }
});

test("IPC резервує вибрані профілі, перевіряє членство та відсутність вибраних дій", async () => {
    const f = await fixture();
    try {
        const service = new FarmService({ activityStore: f.activity, guiService: {} });
        await assert.rejects(service.prepareRun({ groupId: f.a.id, profileNos: ["1"] }), /одну дію/);
        const actions = normalizeFarmSettings({ actions: { feed: { enabled: true } } }).actions;
        await assert.rejects(service.prepareRun({ groupId: f.a.id, profileNos: ["4"], actions }), /поточної групи/);
        const handlers = new Map(); let enqueued;
        registerFarmIpcHandlers({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, safeHandler: (fn) => fn,
            profileActivityStore: f.activity, guiService: {}, backgroundTaskManager: { enqueue: async (options) => { enqueued = options; return { id: "task" }; } } });
        await handlers.get("farm:run")({ groupId: f.a.id, profileNos: ["1", "2"], actions });
        assert.deepEqual(enqueued.resources.map((r) => r.key), ["adspower-profile:1", "adspower-profile:2"]);
        await f.store.assign(f.b.id, [f.members[0]]);
        await assert.rejects(enqueued.runner({ signal: new AbortController().signal }), /Склад групи/);
        assert.deepEqual(shuffleFarmItems([1, 2, 3], () => 0), [2, 3, 1]);
    } finally { f.close(); }
});

test("скасований запит AdsPower не надсилається після черги й не блокує наступний", async () => {
    const adapter = axios.defaults.adapter;
    const calls = [];
    axios.defaults.adapter = async (config) => {
        calls.push(config.url);
        return { status: 200, data: { code: 0 }, headers: {}, config };
    };
    try {
        const adsPower = new AdsPower();
        adsPower.requestDelay = 0;
        let release;
        adsPower.requestQueue = new Promise((resolve) => { release = resolve; });
        const controller = new AbortController();
        const pending = adsPower.request("post", "http://mock.invalid/start", {}, null, { signal: controller.signal });
        controller.abort(); release();
        await assert.rejects(pending);
        assert.equal(calls.length, 0);
        await adsPower.request("post", "http://mock.invalid/stop", {});
        assert.deepEqual(calls, ["http://mock.invalid/stop"]);
    } finally { axios.defaults.adapter = adapter; }
});
