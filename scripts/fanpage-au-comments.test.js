import test from "node:test";
import assert from "node:assert/strict";
import FanPageCommentsService from "../services/autoupload/FanPageCommentsService.js";
import { MAN_TAG_ID, WOMAN_TAG_ID, BAN_TAG_ID, LOGIN_ERROR_TAG_ID } from "../config.js";

test("AU Comments відсіює заблоковані профілі та зберігає всі рядки діалогу", async () => {
    const tags = [[MAN_TAG_ID], [WOMAN_TAG_ID], [MAN_TAG_ID, BAN_TAG_ID], [WOMAN_TAG_ID, LOGIN_ERROR_TAG_ID], [], [MAN_TAG_ID, WOMAN_TAG_ID]];
    const profiles = tags.map((ids, index) => ({ profile_id: `p${index}`, profile_no: String(index), name: "Тест", profile_tags: ids.map(id => ({ id })) }));
    const service = new FanPageCommentsService({ adsPower: { getProfilesByGroupId: async () => profiles }, guiService: {
        prepareCommentingComments: async () => [
            { text: "Перший", gender: "male", parent_id: null },
            { text: "Реплай", gender: "female", parent_id: "1" },
            { text: "Автор", is_author: true, parent_id: null },
            { text: "Не писати", should_write: false, parent_id: null },
        ],
    } });
    assert.deepEqual((await service.profiles(["g1"])).map(p => p.profileId), ["p0", "p1"]);
    const prepared = await service.prepare({ groupIds: ["g1"], geo: "US", creativeName: "202", postUrl: "https://www.facebook.com/page/posts/123" });
    assert.deepEqual(prepared.comments, ["Перший", "Реплай"]);
    assert.equal(prepared.commentRows.length, 4);
    assert.equal(prepared.commentRows[1].parent_id, '1');
    assert.equal(prepared.storyId, "123");
    await assert.rejects(service.selected(["p2"], ["g1"]));
});

test("AU Comments бере лише вибрані групи, прибирає дублікати та перевіряє групу перед запуском", async () => {
    const profile = id => ({ profile_id: id, profile_no: id, name: "Тест", profile_tags: [{ id: MAN_TAG_ID }] });
    const groups = { a: [profile("p1")], b: [profile("p1"), profile("p2")], other: [profile("p3")] };
    const calls = [];
    let sent = false;
    const service = new FanPageCommentsService({ adsPower: { getProfilesByGroupId: async id => { calls.push(id); return groups[id]; } },
        autoupload: { publishDialogue: async () => { sent = true; } },
    });
    assert.deepEqual((await service.profiles(["a", "b", "a"])).map(p => p.profileId), ["p1", "p2"]);
    assert.deepEqual(calls, ["a", "b"]);
    await assert.rejects(service.profiles([]), /Оберіть групи/);
    await assert.rejects(service.selected(["p3"], ["a"]), /Список профілів змінився/);
    const selected = await service.selected(["p1"], ["a"]);
    groups.a = [];
    await assert.rejects(service.run(selected, { groupIds: ["a"] }, {}), /Список профілів змінився/);
    assert.equal(sent, false);
});
