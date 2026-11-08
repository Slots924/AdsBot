import test from "node:test";
import assert from "node:assert/strict";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import getAdsManagerSession from "../facebook/autoupload/actions/getAdsManagerSession.js";
import { prepareNameContext } from "../facebook/autoupload/actions/accounts/changeFacebookName.js";
import { actionFailure } from "../facebook/autoupload/graphql/errors.js";
import { HUMAN_CONFIRMATION_REQUIRED as status, HUMAN_CONFIRMATION_CODE as code, isHumanConfirmationUrl } from "../facebook/session/sessionStatus.js";
import handleSessionFailure from "../workflows/autoupload/handleSessionFailure.js";
import checkProfileSession from "../workflows/autoupload/checkProfileSession.js";
import refreshProfileSession from "../workflows/autoupload/refreshProfileSession.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";
import PersonalManager from "../services/personalAccounts/PersonalAutouploadSessionManager.js";
import { BAN_TAG_ID } from "../config.js";
import BackgroundTaskManager from "../services/tasks/BackgroundTaskManager.js";
import BackgroundTaskJournal from "../services/tasks/BackgroundTaskJournal.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const checkpoint = "/checkpoint/1501092823525282/";
const html = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="22123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const cookies = [{ name: "c_user", value: "123", domain: ".facebook.com", path: "/" },
    { name: "xs", value: "fake-cookie", domain: ".facebook.com", path: "/" }];
const failure = () => Object.assign(new Error("Facebook вимагає підтвердити, що ви людина"), {
    sessionStatus: status, code, actionRequired: "confirm_human", safeFacebookError: true,
});
const profile = { profile_id: "p1", profile_no: "1", profile_tags: [{ id: BAN_TAG_ID }],
    user_proxy_config: { proxy_type: "http", proxy_host: "localhost", proxy_port: "1234" } };

function web(request, options = {}) {
    return new FacebookWebClient({ cookies, userAgent: "Fake-UA", httpClient: { request }, ...options });
}

test("checkpoint визначається за точним шляхом і доменом", () => {
    for (const url of [checkpoint, checkpoint.slice(0, -1), `${checkpoint}?next=%2F`, `https://www.facebook.com${checkpoint}`]) {
        assert.equal(isHumanConfirmationUrl(url, "https://accountscenter.facebook.com/profiles/"), true);
    }
    for (const url of ["https://evilfacebook.com" + checkpoint, "http://facebook.com" + checkpoint,
        "/checkpoint/15010928235252820/", "/checkpoint/1501092823525282/extra", "/?next=" + checkpoint]) {
        assert.equal(isHumanConfirmationUrl(url, "https://www.facebook.com/"), false);
    }
});

test("усі три джерела сесії повертають точний статус без завантаження checkpoint", async () => {
    for (const surface of ["facebook", "adsManager", "accountsCenter"]) {
        let blocked = false;
        let requests = 0;
        const notifications = [];
        const client = web(async () => {
            requests++;
            return blocked ? { status: 302, headers: { location: `${checkpoint}?next=%2F` }, data: "" }
                : { status: 200, headers: {}, data: html };
        }, { onSessionStatus: result => notifications.push(result) });
        if (surface !== "facebook") await client.checkSession();
        const before = requests;
        blocked = true;
        const execute = surface === "facebook" ? () => client.checkSession()
            : surface === "adsManager" ? () => getAdsManagerSession(client.getFbData("p1"))
                : () => prepareNameContext(client.getFbData("p1"));
        await assert.rejects(execute(), error => {
            assert.equal(error.sessionStatus, status);
            assert.equal(error.code, code);
            const result = actionFailure(error);
            assert.equal(result.actionRequired, "confirm_human");
            assert.equal(result.retryable, false);
            return true;
        });
        assert.equal(requests - before, 1);
        assert.equal(notifications[0].sessionStatus, status);
        assert.throws(() => client.getFbData("p1"));
    }
});

test("прямий checkpoint і ланцюжок redirect детектяться лише при отриманні сесії", async () => {
    const direct = web(async () => ({ status: 200, headers: {}, data: html }));
    await assert.rejects(direct.requestSessionPage({ url: `https://www.facebook.com${checkpoint}` }), { sessionStatus: status });
    let requests = 0;
    const chain = web(async () => ({ status: 302, data: "", headers: {
        location: ++requests === 1 ? "/session-next" : checkpoint,
    } }));
    await assert.rejects(chain.checkSession(), { sessionStatus: status });
    assert.equal(requests, 2);
    const ordinary = web(async () => ({ status: 302, data: "", headers: { location: checkpoint } }));
    await assert.rejects(ordinary.request({ url: "https://www.facebook.com/api/graphql/", method: "post" }), { sessionStatus: "checkpoint" });
});

test("помилка парсингу та інший checkpoint не означають підтвердження людини", async () => {
    const invalid = web(async () => ({ status: 200, headers: {}, data: "unrecognized" }));
    await assert.rejects(invalid.checkSession(), error => error.sessionStatus === "error");
    const other = web(async () => ({ status: 302, data: "", headers: { location: "/checkpoint/828281030927956/" } }));
    await assert.rejects(other.checkSession(), { sessionStatus: "checkpoint" });
});

test("helper додає BAN лише за точним статусом і не повторює вже оброблений результат", async () => {
    let marks = 0;
    const markBanned = async (_ads, value) => { assert.equal(value, profile); marks++; return { added: true }; };
    assert.deepEqual(await handleSessionFailure({ result: { status: "error" }, markBanned }), { stopProfile: false });
    const handled = await handleSessionFailure({ result: failure(), profile, markBanned });
    assert.equal(handled.stopProfile, true);
    assert.equal(handled.banTag.added, true);
    await handleSessionFailure({ result: { ...failure(), ...handled }, profile, markBanned });
    assert.equal(marks, 1);
    const failed = await handleSessionFailure({ result: failure(), profile, markBanned: async () => { throw new Error("private"); } });
    assert.equal(failed.stopProfile, true);
    assert.equal(failed.banTag.failed, true);
    assert.ok(!JSON.stringify(failed).includes("private"));
});

test("перевірка сесії зберігає статус, код і результат BAN", async () => {
    const prepared = await checkProfileSession({ profileId: "p1", profile,
        adsPower: { getProfileCookies: async () => cookies, getProfileUserAgent: async () => "Fake-UA" },
        createClient: () => ({ checkSession: async () => { throw failure(); } }),
    });
    assert.equal(prepared.client, null);
    assert.equal(prepared.result.status, status);
    assert.equal(prepared.result.code, code);
    assert.equal(prepared.result.banTag.alreadyBanned, true);
});

test("checkpoint Ads Manager припиняє refresh до читання активів", async () => {
    let calls = 0;
    const prepared = await refreshProfileSession({ profileId: "p1", profile,
        adsPower: { getProfileCookies: async () => cookies, getProfileUserAgent: async () => "Fake-UA" },
        createClient: () => web(async () => ++calls === 1 ? { status: 200, headers: {}, data: html }
            : { status: 302, headers: { location: checkpoint }, data: "" }),
    });
    assert.equal(prepared.client, null);
    assert.equal(prepared.result.status, status);
    assert.equal(prepared.result.capabilities.facebook, false);
    assert.equal(prepared.result.banTag.alreadyBanned, true);
    assert.equal(calls, 2);
});

function serviceFixture() {
    const entries = [];
    const state = { profiles: [{ profileId: "p1", profileNo: "1" }], groups: [], history: [] };
    const store = { snapshot: async () => state,
        setAccountStatus: async (_id, value, message) => Object.assign(state.profiles[0], { status: value, message }),
        record: async (_id, value) => { entries.push(value); Object.assign(state.profiles[0], { status: value.status }); },
        recordAction: async (_id, value) => entries.push(value) };
    const service = new AutouploadService({ store, adsPower: { getProfileById: async () => profile },
        checkSession: async () => ({ client: null, result: { status, code, message: "Confirm human", fields: [], steps: [] } }),
    });
    return { service, state, entries };
}

test("GUI перевірка і коментарі завершуються невдачею та не запускають mutation", async () => {
    const { service, entries } = serviceFixture();
    assert.equal((await service.check(["p1"])).taskStatus, "failed");
    assert.equal(entries[0].banTag.alreadyBanned, true);
    let sent = false;
    service.prepareCommentSession = service.checkSession;
    service.createCommentFn = async () => { sent = true; };
    const result = await service.publishComments(["p1"], { postUrl: "https://www.facebook.com/permalink.php?story_fbid=456&id=123", comments: ["Test"] });
    assert.equal(result.taskStatus, "failed");
    assert.equal(sent, false);
    assert.equal(result.result.profiles[0].code, code);
});

test("GUI зміна імені обробляє статус із результату екшену", async () => {
    const { service, state } = serviceFixture();
    service.checkSession = async () => ({ client: { getFbData: () => ({}), validateFbData: () => {} }, result: { status: "active" } });
    await service.check(["p1"]);
    service.changeNameFn = async () => actionFailure(failure());
    const result = await service.changeNames(["p1"], { firstName: "Test", lastName: "User" });
    assert.equal(result.taskStatus, "failed");
    assert.equal(result.result.profiles[0].banTag.alreadyBanned, true);
    assert.equal(state.profiles[0].status, status);
});

test("масова перевірка продовжує інші профілі після checkpoint", async () => {
    const { service, state } = serviceFixture();
    state.profiles.push({ profileId: "p2", profileNo: "2" });
    service.checkSession = async ({ profileId }) => profileId === "p1"
        ? { client: null, result: { status, code, message: "Confirm human", fields: [], steps: [] } }
        : { client: {}, result: { status: "active", message: "Active", fields: [], steps: [] } };
    const result = await service.check(["p1", "p2"]);
    assert.equal(result.taskStatus, "failed");
    assert.equal(result.result.profiles.length, 2);
    assert.equal(result.result.profiles[0].status, status);
    assert.equal(result.result.profiles[1].status, "active");
});

test("персональний запуск зберігає конкретну причину невдачі", async () => {
    let removed = false;
    const manager = new PersonalManager({ adsPower: { getProfileByNo: async () => profile, getProfileById: async () => profile },
        sessionStore: { load: async () => null, remove: async () => { removed = true; } },
        refreshSession: async () => ({ client: null, result: { status, sessionStatus: status, code, message: "Confirm human" } }),
    });
    await assert.rejects(manager.start({ profileNo: "1" }), error => error.sessionStatus === status && error.code === code && error.banTag.alreadyBanned);
    assert.equal(removed, true);
    assert.equal(manager.sessions.size, 0);
});

test("черга GUI зберігає failed і результати профілів без винятку runner", async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-checkpoint-queue-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("adsbot-checkpoint-queue-"));
        await rm(directory, { recursive: true, force: true });
    });
    const manager = new BackgroundTaskManager({ journal: new BackgroundTaskJournal({ tasksFile: path.join(directory, "tasks.json") }) });
    await manager.initialize();
    const finished = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Задача не завершилася")), 3000);
        manager.subscribe(event => {
            if (event.type === "updated" && event.task.status === "failed") {
                clearTimeout(timer);
                resolve(event.task);
            }
        });
    });
    await manager.enqueue({ type: "autoupload-session-check", name: "Checkpoint", resources: [],
        runner: async () => ({ taskStatus: "failed", result: { profiles: [{ sessionStatus: status, code }] } }) });
    const task = await finished;
    assert.equal(task.status, "failed");
    assert.equal(task.result.profiles[0].sessionStatus, status);
});
