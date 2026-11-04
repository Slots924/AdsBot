import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import changeFacebookName from "../facebook/autoupload/actions/accounts/changeFacebookName.js";
import sendFriendRequest from "../facebook/autoupload/actions/friends/sendFriendRequest.js";
import getAdsManagerSession from "../facebook/autoupload/actions/getAdsManagerSession.js";
import ProxyHttpClient from "../services/proxy/ProxyHttpClient.js";
import TaskReportManager from "../services/reports/TaskReportManager.js";
import BackgroundTaskJournal from "../services/tasks/BackgroundTaskJournal.js";
import BackgroundTaskManager from "../services/tasks/BackgroundTaskManager.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";
import AutouploadStore from "../services/autoupload/AutouploadStore.js";
import saveCommentAccountSetupReport from "../services/reports/saveCommentAccountSetupReport.js";
import { withHttpAction, withHttpWorkflow, traceHttpRequest, currentHttpHistory } from "../services/reports/HttpExchangeTrace.js";
import { readHttpHistory } from "../services/reports/httpHistoryReport.js";
import { cleanHistory, requestSnapshot, responseSnapshot } from "../services/reports/httpHistoryPolicy.js";

const html = '<html>DTSGInitialData",[],{"token":"private-dtsg"} LSD",[],{"token":"private-lsd"} <input name="jazoest" value="22123"> {"sessionId":"private-session","actorID":"123","client_revision":456}</html>';
const credential = `EAAB${"x".repeat(40)}`;
const cookies = [{ name: "c_user", value: "123", domain: ".facebook.com", path: "/" },
    { name: "xs", value: "private-cookie", domain: ".facebook.com", path: "/" }];
const reply = (data, status = 200, headers = {}) => ({ data, status, headers });
const createClient = request => new FacebookWebClient({ cookies, userAgent: "History-Test", httpClient: { request } });

test("JSON-відмова з Content-Type text/html зберігає серверний код і текст без credentials", () => {
    const response = reply('for (;;);{"error":1533002,"errorDescription":"Test rejection","access_token":"private-test-token"}', 200, { "content-type": "text/html; charset=utf-8" });
    const snapshot = cleanHistory(responseSnapshot(response, { url: "https://adsmanager.facebook.com/api/graphql/" }));
    assert.equal(snapshot.body.error, 1533002);
    assert.equal(snapshot.body.errorDescription, "Test rejection");
    assert.equal(snapshot.body.bodyOmitted, undefined);
    assert.ok(!JSON.stringify(snapshot).includes("private-test-token"));
});

async function temporary(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-http-history-"));
    t.after(async () => {
        const target = path.resolve(directory);
        assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
        assert.ok(path.basename(target).startsWith("adsbot-http-history-"));
        await rm(target, { recursive: true, force: true });
    });
    return directory;
}

test("екшен імені повертає фактичні GET і GraphQL, зберігаючи старі поля результату", async () => {
    const client = createClient(async config => {
        if (!config.method || config.method === "get") return reply(html, 200, { "content-type": "text/html" });
        const operation = new URLSearchParams(config.data).get("fb_api_req_friendly_name");
        const data = operation === "FXIMIdentityNameEditorDialogQuery"
            ? { fxim_identity_for_id: { canonical_id: "123", screen_rules: { name: { legacy_name_data: { can_change_name: true }, cooldown_status: false } } } }
            : operation === "useFXIMNameValidatorQuery" ? { fx_identity_management: { validate_name_v2: { is_valid: true } } }
                : { fxim_update_identity_name: { error: null } };
        return reply(JSON.stringify({ data }));
    });
    await client.checkSession();
    const result = await changeFacebookName(client.getFbData("p1"), { firstName: "Test", lastName: "User" });
    assert.equal(result.success, true);
    assert.equal(result.outcome, "NAME_CHANGED");
    assert.equal(result.exchanges.length, 4);
    const write = result.exchanges.at(-1);
    assert.equal(write.request.body.fb_api_req_friendly_name, "useFXIMUpdateNameMutation");
    assert.equal(write.request.body.variables.first_name, "Test");
    assert.equal(write.response.body.data.fxim_update_identity_name.error, null);
    assert.equal(result.exchanges[0].response.body.kind, "html");
    assert.ok(result.exchanges[0].response.body.sessionFieldsFound.includes("fb_dtsg"));
    for (const secret of ["private-dtsg", "private-lsd", "private-cookie", "private-session", "<html>"]) assert.ok(!JSON.stringify(result).includes(secret));
});

test("сторінка Ads Manager містить лише ознаки полів сесії й access token", async () => {
    const client = createClient(async () => reply(html.replace("</html>", `{"accessToken":"${credential}"}</html>`), 200, { "content-type": "text/html" }));
    await client.checkSession();
    const result = await getAdsManagerSession(client.getFbData("p1"));
    assert.equal(result.hasAccessToken, true);
    assert.equal(result.exchanges[0].response.body.adsManagerCredentialFound, true);
    assert.ok(!JSON.stringify(result).includes(credential));
    assert.ok(!JSON.stringify(result).includes("private-dtsg"));
});

test("GraphQL-відмова, невалідний JSON і timeout залишають відповідь або мережевий код без повтору POST", async () => {
    for (const mode of ["rejected", "invalid", "timeout"]) {
        let calls = 0;
        const client = createClient(async config => {
            if (!config.method || config.method === "get") return reply(html);
            calls++;
            if (mode === "timeout") throw Object.assign(new Error("untrusted-network-details"), { code: "ETIMEDOUT" });
            return mode === "invalid" ? reply("for (;;);{invalid-json")
                : reply(JSON.stringify({ errors: [{ code: 1357004, message: "Facebook rejected operation" }] }));
        });
        await client.checkSession();
        const result = await sendFriendRequest(client.getFbData("p1"), "456");
        assert.equal(result.success, false);
        assert.equal(calls, 1);
        assert.equal(result.exchanges.length, 1);
        if (mode === "timeout") {
            assert.equal(result.outcomeUnknown, true);
            assert.equal(result.exchanges[0].error.code, "ETIMEDOUT");
            assert.equal(result.exchanges[0].response, null);
        } else assert.ok(result.exchanges[0].response.body);
        assert.ok(!JSON.stringify(result.exchanges).includes("untrusted-network-details"));
    }
});

test("велика відповідь, глибокі дані, multipart і секрети не гублять діагностичну інформацію", () => {
    const big = { data: { a: { b: { c: { d: { e: { f: { items: Array.from({ length: 130 }, (_, id) => ({ id, text: "z".repeat(9000), access_token: credential })) } } } } } } } };
    const clean = cleanHistory(big);
    const items = clean.data.a.b.c.d.e.f.items;
    assert.equal(items.length, 130);
    assert.equal(items[129].text.length, 9000);
    assert.equal(items[129].access_token, "[REDACTED]");
    const form = new FormData();
    form.append("photo", new Blob(["image-bytes"]), "photo.jpg");
    const request = requestSnapshot({ url: "https://www.facebook.com/upload?lsd=private-lsd&id=123", data: form });
    assert.equal(request.body.photo.name, "photo.jpg");
    assert.equal(request.body.photo.size, 11);
    assert.ok(!JSON.stringify(request).includes("image-bytes"));
    assert.ok(!request.url.includes("private-lsd"));
    assert.equal(responseSnapshot(reply("large-js", 200, { "content-type": "application/javascript" }), { url: "https://static.xx.fbcdn.net/rsrc.php/script" }).body.bodyOmitted, true);
});

test("журнал записує намір до HTTP та відповідь до помилки парсера; експорт не обрізає дані", async t => {
    const directory = await temporary(t);
    let reference;
    const result = await withHttpWorkflow("setup", async () => {
        const action = await withHttpAction("update", async () => {
            await traceHttpRequest({ url: "https://www.facebook.com/api/graphql/", method: "post", data: "fb_dtsg=private-dtsg&variables=%7B%22id%22%3A123%7D" }, async () => {
                reference = currentHttpHistory();
                const inFlight = await readFile(reference.path, "utf8");
                assert.ok(inFlight.includes("request.started"));
                assert.ok(!inFlight.includes("request.finished"));
                return reply({ data: { items: Array.from({ length: 120 }, (_, id) => ({ id, description: "v".repeat(9000) })) } });
            });
            return { success: false, outcome: "NOT_CONFIRMED", message: "Немає потрібного поля" };
        });
        return { profiles: [{ profileNo: "1", action }] };
    }, { directory });
    assert.equal(result.httpHistory.requestCount, 1);
    assert.equal(result.profiles[0].action.exchanges, undefined);
    const events = await readHttpHistory(result.httpHistory, directory);
    assert.equal(events.filter(event => event.event === "request.finished").length, 1);
    assert.equal(events.find(event => event.event === "request.finished").response.body.data.items.length, 120);
    assert.ok(!JSON.stringify(events).includes("private-dtsg"));
    const manager = new TaskReportManager({ reportsDirectory: path.join(directory, "tasks"), httpHistoryDirectory: directory });
    const report = await manager.createFromTask({ id: "t1", name: "Автозалив", type: "autoupload-test", status: "completed_with_warnings", result });
    const loaded = await manager.get(report.id, { includeHttpHistory: true });
    assert.equal(loaded.httpHistoryEvents.find(event => event.event === "request.finished").response.body.data.items[119].description.length, 9000);
    const exported = path.join(directory, "report.md");
    await manager.exportMarkdown(report.id, exported);
    const markdown = await readFile(exported, "utf8");
    assert.ok(markdown.includes("Історія HTTP-запитів Facebook"));
    assert.ok(markdown.includes('"id": 119'));
    assert.ok(!markdown.includes("[MAX_DEPTH]"));
    await assert.rejects(readHttpHistory({ ...reference, path: exported }, directory), { code: "HTTP_HISTORY_PATH_INVALID" });
});

test("перенаправлення й паралельні екшени мають окремі запити без змішування історій", async () => {
    const client = createClient(async config => config.url.endsWith("/start") ? reply("", 302, { location: "/end" }) : reply("{}"));
    const [first, second] = await Promise.all(["start", "other"].map(route => withHttpAction(route, async () => {
        await client.request({ url: `https://www.facebook.com/${route}` });
        return { success: true };
    })));
    assert.equal(first.exchanges.length, 2);
    assert.equal(second.exchanges.length, 1);
    assert.ok(first.exchanges.every(exchange => exchange.action === "start"));
    assert.ok(second.exchanges.every(exchange => exchange.action === "other"));
    assert.notEqual(first.actionId, second.actionId);
});

test("фактичні спроби ProxyHttpClient записуються окремо й не дублюються", async () => {
    let calls = 0;
    const proxy = new ProxyHttpClient({ proxies: [{ id: "p1", type: "http", host: "127.0.0.1", port: 1234 }, { id: "p2", type: "http", host: "127.0.0.1", port: 1235 }],
        checkProxyFn: async () => ({ working: true }), httpClient: { request: async () => {
            calls++;
            if (calls === 1) throw Object.assign(new Error("private-proxy-details"), { code: "ECONNRESET" });
            return reply("{}");
        } } });
    const client = new FacebookWebClient({ cookies, userAgent: "Test", httpClient: proxy });
    const result = await withHttpAction("read", async () => {
        await client.request({ url: "https://www.facebook.com/data" });
        return { success: true };
    });
    assert.equal(calls, 2);
    assert.equal(result.exchanges.length, 2);
    assert.equal(result.exchanges[0].error.code, "ECONNRESET");
    assert.equal(result.exchanges[1].response.status, 200);
    assert.deepEqual(result.exchanges.map(exchange => exchange.attempt), [1, 2]);
    assert.equal(result.exchanges[0].requestGroupId, result.exchanges[1].requestGroupId);
    assert.ok(!JSON.stringify(result).includes("private-proxy-details"));
});

test("дія GUI без фонової задачі створює один звіт до HTTP й оновлює його після завершення", async t => {
    const directory = await temporary(t);
    const reportManager = new TaskReportManager({ reportsDirectory: path.join(directory, "tasks"), httpHistoryDirectory: path.join(directory, "http") });
    const store = new AutouploadStore(path.join(directory, "state.json"));
    await store.add([{ profileId: "p1", profileNo: "1", name: "Test" }], "new");
    const client = createClient(async () => {
        const reports = await reportManager.list();
        assert.equal(reports.length, 1);
        assert.equal(reports[0].status, "running");
        return reply("{}");
    });
    const service = new AutouploadService({ store, reportManager,
        checkSession: async () => ({ client, result: { status: "active", message: "Ready", fields: [], steps: [] } }),
        getFanPagesFn: async value => {
            await value.request({ url: "https://www.facebook.com/data" });
            return { success: true, pages: [] };
        },
    });
    const result = await service.listFanPages(["p1"]);
    assert.ok(result.reportId);
    assert.equal((await reportManager.list()).length, 1);
    assert.equal((await reportManager.get(result.reportId, { includeHttpHistory: true })).status, "completed");
});

test("перезапуск відновлює окремий звіт, незавершений запит і пошкоджений останній рядок", async t => {
    const directory = await temporary(t);
    const manager = new TaskReportManager({ reportsDirectory: path.join(directory, "tasks"), httpHistoryDirectory: directory });
    const id = "11111111-1111-4111-8111-111111111111";
    const httpHistory = { id, path: path.join(directory, `${id}.jsonl`), requestCount: 1 };
    await writeFile(httpHistory.path, `${JSON.stringify({ event: "request.started", requestId: "r1", request: { method: "POST", url: "https://www.facebook.com/api/graphql/" } })}\n{"event":`);
    const pending = await manager.createFromTask({ id: null, name: "Доступ до фанки", type: "autoupload-shareFanPage", status: "running", metadata: { httpHistory } });
    await manager.recoverInterrupted();
    const report = await manager.get(pending.id, { includeHttpHistory: true });
    assert.equal(report.status, "interrupted");
    assert.ok(report.httpHistoryEvents.some(event => event.event === "request.started"));
    assert.ok(report.httpHistoryEvents.some(event => event.event === "history.incomplete"));
    const setupPath = await saveCommentAccountSetupReport({ startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        profiles: [{ profileNo: "1", outcome: "failed", httpHistory, steps: {} }] }, path.join(directory, "setup"), { httpHistoryDirectory: directory });
    assert.ok((await readFile(setupPath, "utf8")).includes("Історія HTTP-запитів Facebook"));
});

test("збій диска не змінює успіх mutation; переривання зберігає часткову історію", async t => {
    const directory = await temporary(t);
    const blocked = path.join(directory, "file");
    await writeFile(blocked, "occupied");
    let sent = 0;
    const result = await withHttpWorkflow("write", async () => {
        await traceHttpRequest({ url: "https://www.facebook.com/api/graphql/", method: "post" }, async () => { sent++; return reply("{}"); });
        return { success: true };
    }, { directory: blocked });
    assert.equal(result.success, true);
    assert.equal(sent, 1);
    assert.ok(result.httpHistory.storageWarning);
    let failure;
    try {
        await withHttpWorkflow("interrupted", async () => {
            await traceHttpRequest({ url: "https://www.facebook.com/data" }, async () => reply("{}"));
            throw Object.assign(new Error("cancelled"), { name: "AbortError" });
        }, { directory });
    } catch (error) { failure = error; }
    assert.ok(failure.httpHistory);
    assert.ok((await readHttpHistory(failure.httpHistory, directory)).some(event => event.event === "history.failed"));
});

test("фонова задача зберігає посилання до завершення запиту та підключає історію до звіту", async t => {
    const directory = await temporary(t);
    const journal = new BackgroundTaskJournal({ tasksFile: path.join(directory, "tasks.json") });
    const reportManager = new TaskReportManager({ reportsDirectory: path.join(directory, "reports"), httpHistoryDirectory: path.join(directory, "http") });
    const manager = new BackgroundTaskManager({ journal, reportManager });
    await manager.initialize();
    let taskId;
    const task = await manager.enqueue({ type: "autoupload-history-test", name: "Історія", input: {}, runner: async ({ task: running }) => {
        taskId = running.id;
        await traceHttpRequest({ url: "https://www.facebook.com/api/graphql/", method: "post" }, async () => {
            const saved = await journal.get(taskId);
            assert.ok(saved.metadata.httpHistory.path);
            return reply('{"data":{"accepted":true}}');
        });
        return { result: { success: true } };
    } });
    for (let attempt = 0; attempt < 200 && !(await journal.get(task.id)).metadata.reportId; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    const finished = await journal.get(task.id);
    assert.equal(finished.status, "completed");
    const report = await reportManager.get(finished.metadata.reportId, { includeHttpHistory: true });
    assert.equal(report.httpHistories.length, 1);
    assert.equal(report.httpHistoryEvents.find(event => event.event === "request.finished").response.body.data.accepted, true);
});
