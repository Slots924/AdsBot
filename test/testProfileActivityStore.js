import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ProfileActivityStore, { profileActivityTypes as types } from "../services/profile/ProfileActivityStore.js";

const store = new ProfileActivityStore({ databaseFile: ":memory:" });
const setup = (profileNo, actionType, occurredAt, outcome = "success") => store.recordSuccessfulAction({ profileNo, actionType, occurredAt, outcome });
try {
    await setup("mixed", types.COMMENT_ACCOUNT_SETUP_UI, "2026-01-01T10:00:00Z");
    await setup("mixed", types.COMMENT_ACCOUNT_SETUP_API, "2026-01-02T10:00:00Z");
    await setup("mixed", types.COMMENT_TASK, "2026-01-03T10:00:00Z");
    await setup("mixed", types.COMMENT_TASK, "2026-01-04T10:00:00Z");
    await setup("mixed", types.COMMENT_REACTIONS_TASK, "2026-01-04T10:00:00Z", "completed_with_warnings");
    await store.markBanned("mixed", "2026-02-01T10:00:00Z");
    await setup("mixed", types.COMMENT_ACCOUNT_SETUP_UI, "2026-02-02T10:00:00Z");
    await setup("mixed", types.COMMENT_TASK, "2026-02-02T10:00:00Z");
    await store.markBanned("mixed", "2026-03-01T10:00:00Z");
    await setup("zero", types.COMMENT_ACCOUNT_SETUP_API, "2026-01-02T10:00:00Z");
    await store.markBanned("zero", "2026-02-02T10:00:00Z");
    await store.markBanned("regular", "2026-03-01T10:00:00Z");
    await setup("live", types.COMMENT_ACCOUNT_SETUP_API, "2026-01-01T10:00:00Z");
    await setup("live", types.COMMENT_ACCOUNT_SETUP_UI, "2026-01-01T10:00:00.000Z");

    const all = await store.list({ bannedOnly: false });
    assert.equal(all.items.find((item) => item.profileNo === "mixed").accountType, "api");
    assert.equal(all.items.find((item) => item.profileNo === "live").accountType, "ui");
    assert.equal(all.items.find((item) => item.profileNo === "mixed").commentAccountSetupUiCount, 2);
    assert.equal(all.items.find((item) => item.profileNo === "mixed").totalTargetActions, 4);
    assert.equal(all.items.find((item) => item.profileNo === "live").totalTargetActions, 0);
    const api = all.comparison.groups.find((group) => group.accountType === "api");
    assert.equal(api.bannedCount, 2);
    assert.equal(api.averages[types.COMMENT_TASK], 1);
    assert.equal(api.averages[types.COMMENT_REACTIONS_TASK], 0.5);
    assert.equal(all.comparison.groups.find((group) => group.accountType === "ui").averages[types.COMMENT_TASK], null);
    const filtered = await store.list({ includedAccountTypes: ["regular"] });
    assert.deepEqual(filtered.items.map((item) => item.profileNo), ["regular"]);
    assert.deepEqual(filtered.comparison, all.comparison);
    const empty = await store.list({ includedAccountTypes: [] });
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.items, []);
    const period = await store.compareBanned({ dateFrom: "2026-02-01T10:00:00Z", dateTo: "2026-02-01T10:00:00Z" });
    assert.equal(period.groups.find((group) => group.accountType === "api").bannedCount, 1);
    assert.equal(period.groups.find((group) => group.accountType === "api").averages[types.COMMENT_TASK], 2);
    const since = await store.compareBanned({ dateFrom: "2026-02-02T00:00:00Z" });
    assert.equal(since.groups.find((group) => group.accountType === "api").bannedCount, 1);
    await assert.rejects(store.compareBanned({ dateFrom: "invalid" }), /Некоректна дата/);
    await assert.rejects(store.compareBanned({ dateFrom: "2026-03-01", dateTo: "2026-02-01" }), /не пізніше/);
    await store.remove(["mixed"]);
    assert.equal((await store.compareBanned()).groups.find((group) => group.accountType === "api").bannedCount, 1);
    await store.syncProfileGroups([{ profile_no: "live", group_id: "1", group_name: "Перша група" }]);
    await store.syncProfileGroups([{ profile_no: "live", group_id: "2", group_name: "Друга група" }]);
    await store.markBanned("live");
    await store.syncProfileGroups([{ profile_no: "live", group_id: "3", group_name: "Архів" }]);
    const frozen = (await store.list()).items.find((item) => item.profileNo === "live");
    assert.equal(frozen.adsPowerGroupId, "2");
    assert.equal(frozen.adsPowerGroupName, "Друга група");
    await setup("live", types.COMMENT_TASK, "2026-04-01T10:00:00Z");
    assert.equal((await store.list()).items.find((item) => item.profileNo === "live").adsPowerGroupName, "Друга група");
    const before = (await store.list({ bannedOnly: false })).total;
    await store.syncProfileGroups([{ profile_no: "new", group_id: "4", group_name: "Нова група" }]);
    assert.equal((await store.list({ bannedOnly: false })).total, before);
    await setup("new", types.COMMENT_TASK, "2026-04-01T10:00:00Z");
    const created = (await store.list({ bannedOnly: false })).items.find((item) => item.profileNo === "new");
    assert.equal(created.adsPowerGroupName, "Нова група");
    console.log("Статистика типів акаунтів, задач і груп: перевірки пройшли");
} finally {
    store.db?.close();
}

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-profile-activity-"));
const databaseFile = path.join(directory, "legacy.sqlite");
let legacy;
let migrated;
try {
    legacy = new ProfileActivityStore({ databaseFile });
    await legacy.recordSuccessfulAction({ profileNo: "old", actionType: types.COMMENT_ACCOUNT_SETUP_API });
    await legacy.recordSuccessfulAction({ profileNo: "old", actionType: types.COMMENT_TASK });
    await legacy.recordSuccessfulAction({ profileNo: "idle", actionType: types.COMMENT_TASK });
    await legacy.markBanned("banned-old");
    // Відтворюємо попередню схему та загальний лічильник з оформленням акаунта.
    legacy.db.exec(`ALTER TABLE profile_activity DROP COLUMN adspower_group_id;
        ALTER TABLE profile_activity DROP COLUMN adspower_group_name;
        ALTER TABLE profile_activity DROP COLUMN track_adspower_group;
        UPDATE profile_activity SET total_target_actions = 2;`);
    legacy.db.close();
    legacy = null;
    migrated = new ProfileActivityStore({ databaseFile });
    await migrated.syncProfileGroups([
        { profile_no: "old", group_id: "1", group_name: "Поточна" },
        { profile_no: "idle", group_id: "1", group_name: "Поточна" },
        { profile_no: "banned-old", group_id: "1", group_name: "Поточна" },
        { profile_no: "fresh", group_id: "2", group_name: "Нова" },
    ]);
    assert.equal((await migrated.list({ bannedOnly: false })).items.find((item) => item.profileNo === "old").adsPowerGroupName, null);
    await migrated.recordSuccessfulAction({ profileNo: "old", actionType: types.COMMENT_TASK });
    assert.equal((await migrated.list({ bannedOnly: false })).items.find((item) => item.profileNo === "old").adsPowerGroupName, "Поточна");
    await migrated.syncProfileGroups([{ profile_no: "old", group_id: "3", group_name: "Оновлена" }]);
    await migrated.recordSuccessfulAction({ profileNo: "old", actionType: types.COMMENT_REACTIONS_TASK });
    const updated = (await migrated.list({ bannedOnly: false })).items.find((item) => item.profileNo === "old");
    assert.equal(updated.adsPowerGroupId, "3");
    assert.equal(updated.adsPowerGroupName, "Оновлена");
    await migrated.recordSuccessfulAction({ profileNo: "banned-old", actionType: types.COMMENT_TASK });
    const untouched = (await migrated.list({ bannedOnly: false })).items;
    assert.equal(untouched.find((item) => item.profileNo === "idle").adsPowerGroupName, null);
    assert.equal(untouched.find((item) => item.profileNo === "banned-old").adsPowerGroupName, null);
    await migrated.recordSuccessfulAction({ profileNo: "old", actionType: types.COMMENT_ACCOUNT_SETUP_UI });
    await migrated.markBanned("old");
    await migrated.markBanned("fresh");
    const result = await migrated.list();
    assert.equal(result.items.find((item) => item.profileNo === "old").totalTargetActions, 3);
    assert.equal(result.items.find((item) => item.profileNo === "old").adsPowerGroupName, "Оновлена");
    assert.equal(result.items.find((item) => item.profileNo === "fresh").adsPowerGroupName, "Нова");
    migrated.db.close();
    migrated = new ProfileActivityStore({ databaseFile });
    await migrated.syncProfileGroups([{ profile_no: "fresh", group_id: "3", group_name: "Архів" }]);
    assert.equal((await migrated.list()).items.find((item) => item.profileNo === "fresh").adsPowerGroupName, "Нова");
    await migrated.syncProfileGroups([{ profile_no: "old", group_id: "4", group_name: "Архів" }]);
    await migrated.recordSuccessfulAction({ profileNo: "old", actionType: types.COMMENT_TASK });
    assert.equal((await migrated.list()).items.find((item) => item.profileNo === "old").adsPowerGroupName, "Оновлена");
    console.log("Міграція статистики та фіксація групи після бану: перевірки пройшли");
} finally {
    legacy?.db?.close();
    migrated?.db?.close();
    await rm(directory, { recursive: true, force: true });
}
