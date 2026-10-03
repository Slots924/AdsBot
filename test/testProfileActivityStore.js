import assert from "node:assert/strict";
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
    console.log("Статистика типів акаунтів і задач до бану: перевірки пройшли");
} finally {
    store.db?.close();
}
