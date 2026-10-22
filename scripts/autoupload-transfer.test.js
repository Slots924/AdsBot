import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import AutouploadStore from "../services/autoupload/AutouploadStore.js";
import AutouploadService from "../services/autoupload/AutouploadService.js";
import AdsPower from "../classes/AdsPower.js";

const account = id => ({ id: `act_${id}`, accountId: id, isPersonal: true, businessId: null });
async function fixture(t, { kingAccounts = [], acceptFails = false, shareFails = false } = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-transfer-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("adsbot-transfer-"));
        await rm(directory, { recursive: true, force: true });
    });
    const store = new AutouploadStore(path.join(directory, "workspace.json"));
    const calls = [];
    const assets = { donor: [account("101"), { ...account("999"), isPersonal: false, businessId: "1" }], donor2: [account("101")], king: kingAccounts.map(account) };
    await store.add(Object.keys(assets).map((profileId, index) => ({ profileId, profileNo: String(index + 1), name: profileId })), "new");
    const service = new AutouploadService({ store,
        adsPower: { updateProfileName: async (...args) => calls.push(["rename", ...args]), deleteProfile: async id => calls.push(["delete", id]) },
        checkSession: async ({ profileId }) => {
            calls.push(["check", profileId]);
            return { client: { validateFbData() {}, getFbData: () => ({ userId: profileId === "king" ? "456" : "123" }) },
                result: { status: "active", message: "Готово", steps: [], assets: { adAccounts: assets[profileId], adAccountsState: "loaded" } } };
        },
        sendFriendRequestFn: async (_fbData, id, options) => {
            calls.push(["send", id]); await options.beforeSend();
            return { success: true, message: "Заявку надіслано" };
        },
        acceptFriendRequestFn: async (_fbData, id, options) => {
            calls.push(["accept", id, options.attemptOnCheckFailure]);
            return { success: !acceptFails, code: acceptFails ? "ACCEPT_ERROR" : null, message: acceptFails ? "Помилка прийняття" : "Прийнято" };
        },
        shareAdAccountFn: async (_fbData, id, target, options) => {
            calls.push(["share", id, target, options.useCachedAccess]); await options.beforeSend();
            return { success: !shareFails, message: shareFails ? "Помилка Facebook: доступ заборонено" : "Доступ надано" };
        },
    });
    await service.check(["donor", "donor2", "king"]);
    calls.length = 0;
    return { service, store, calls };
}

test("збережені РК кінга виключають усі запити донору, навіть якщо сесії недоступні", async t => {
    const { store, calls } = await fixture(t, { kingAccounts: ["101"] });
    const restarted = new AutouploadService({ store, checkSession: async () => { throw new Error("Повторна перевірка заборонена"); } });
    const result = await restarted.transferPersonalAccounts({ ids: ["donor"], targetProfileId: "king" });
    assert.deepEqual(calls, []);
    assert.equal(result.result.profiles[0].outcome, "SKIPPED");
});

test("відсутня збережена сесія повертає помилку без автоматичної перевірки", async t => {
    const { store } = await fixture(t);
    let checked = false;
    const restarted = new AutouploadService({ store, checkSession: async () => { checked = true; } });
    const result = await restarted.transferPersonalAccounts({ ids: ["donor"], targetProfileId: "king" });
    assert.equal(checked, false);
    assert.equal(result.taskStatus, "completed_with_warnings");
    assert.equal(result.result.profiles[0].code, "FACEBOOK_SESSION_PREPARATION_FAILED");
});

test("профілі не видаляються і не перейменовуються під час передачі", async t => {
    const { service } = await fixture(t);
    let release;
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    service.sendFriendRequestFn = async () => { started(); await gate; return { success: true, message: "Надіслано" }; };
    const task = service.transferPersonalAccounts({ ids: ["donor"], targetProfileId: "king" });
    await entered;
    try {
        await assert.rejects(service.mutate({ action: "remove", ids: ["king"], deleteAdsPower: true }), /завершення операції/);
        await assert.rejects(service.mutate({ action: "rename-profile", id: "donor", name: "Нова" }), /завершення операції/);
    } finally { release(); }
    await task;
});

test("передача без повторної перевірки, оновлення кінга та пропуск наступного донора і повторного запуску", async t => {
    const { service, store, calls } = await fixture(t);
    const input = { ids: ["donor", "donor2"], targetProfileId: "king" };
    const result = await service.transferPersonalAccounts(input);
    assert.equal(result.taskStatus, "completed");
    assert.deepEqual(calls, [["send", "456"], ["accept", "123", true], ["share", "101", "456", true]]);
    assert.deepEqual((await store.snapshot()).profiles.find(p => p.profileId === "king").assets.adAccounts.map(a => a.accountId), ["101"]);
    calls.length = 0;
    await service.transferPersonalAccounts(input);
    assert.deepEqual(calls, []);
});

test("помилка прийняття зберігається і не блокує спробу шерингу", async t => {
    const { service, store } = await fixture(t, { acceptFails: true });
    const result = await service.transferPersonalAccounts({ ids: ["donor"], targetProfileId: "king" });
    assert.equal(result.taskStatus, "completed_with_warnings");
    assert.ok((await store.snapshot()).history.some(entry => entry.code === "ACCEPT_ERROR" && entry.message === "Помилка прийняття"));
    assert.ok(result.result.profiles.some(entry => entry.operation === "ad-account-share" && entry.success));
});

test("помилка шерингу не додає РК кінгу та повертається в результаті", async t => {
    const { service, store } = await fixture(t, { shareFails: true });
    const result = await service.transferPersonalAccounts({ ids: ["donor"], targetProfileId: "king" });
    assert.equal(result.taskStatus, "completed_with_warnings");
    assert.equal(result.result.profiles.at(-1).message, "Помилка Facebook: доступ заборонено");
    assert.deepEqual((await store.snapshot()).profiles.find(p => p.profileId === "king").assets.adAccounts, []);
});

test("відсутні дані й вибір кінга донором відхиляються до запитів", async t => {
    const { service, store, calls } = await fixture(t);
    await assert.rejects(service.validateTransfer({ ids: ["king"], targetProfileId: "king" }));
    await store.change(state => { state.profiles[0].assets.adAccountsState = "error"; });
    await assert.rejects(service.transferPersonalAccounts({ ids: ["donor"], targetProfileId: "king" }));
    assert.deepEqual(calls, []);
});

test("перейменування оновлює AdsPower і список, видалення з AdsPower лише за явним вибором", async t => {
    const { service, store, calls } = await fixture(t);
    await service.mutate({ action: "rename-profile", id: "donor", name: "Нова назва" });
    assert.equal((await store.snapshot()).profiles[0].name, "Нова назва");
    await service.mutate({ action: "remove", ids: ["donor"] });
    assert.deepEqual(calls, [["rename", "donor", "Нова назва"]]);
    await service.mutate({ action: "remove", ids: ["donor2"], deleteAdsPower: true });
    assert.deepEqual(calls.at(-1), ["delete", "donor2"]);
});

test("відмова AdsPower залишає профіль у списку", async t => {
    const { service, store } = await fixture(t);
    service.adsPower.deleteProfile = async () => { throw new Error("AdsPower: профіль відкритий"); };
    await assert.rejects(service.mutate({ action: "remove", ids: ["donor"], deleteAdsPower: true }), /профіль відкритий/);
    assert.ok((await store.snapshot()).profiles.some(profile => profile.profileId === "donor"));
});

test("видалення AdsPower проходить через централізований request", async () => {
    const adsPower = new AdsPower();
    const calls = [];
    adsPower.request = async (...args) => { calls.push(args); return { data: { code: 0, data: {} } }; };
    await adsPower.deleteProfile("donor");
    assert.equal(calls[0][0], "post");
    assert.ok(calls[0][1].endsWith("/api/v1/user/delete"));
    assert.deepEqual(calls[0][2], { user_ids: ["donor"] });
});
