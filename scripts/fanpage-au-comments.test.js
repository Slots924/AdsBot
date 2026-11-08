import test from "node:test";
import assert from "node:assert/strict";
import FanPageCommentsService from "../services/autoupload/FanPageCommentsService.js";
import { MAN_TAG_ID, WOMAN_TAG_ID, BAN_TAG_ID, LOGIN_ERROR_TAG_ID } from "../config.js";

test("AU Comments відсіює заблоковані профілі, реплаї та автора", async () => {
    const tags = [[MAN_TAG_ID], [WOMAN_TAG_ID], [MAN_TAG_ID, BAN_TAG_ID], [WOMAN_TAG_ID, LOGIN_ERROR_TAG_ID], [], [MAN_TAG_ID, WOMAN_TAG_ID]];
    const profiles = tags.map((ids, index) => ({ profile_id: `p${index}`, profile_no: String(index), name: "Тест", profile_tags: ids.map(id => ({ id })) }));
    const service = new FanPageCommentsService({ adsPower: { getProfiles: async () => profiles }, guiService: {
        prepareCommentingComments: async () => [
            { text: "Перший", gender: "male", parent_id: null },
            { text: "Реплай", gender: "female", parent_id: "1" },
            { text: "Автор", is_author: true, parent_id: null },
            { text: "Не писати", should_write: false, parent_id: null },
        ],
    } });
    assert.deepEqual((await service.profiles()).map(p => p.profileId), ["p0", "p1"]);
    const prepared = await service.prepare({ geo: "US", creativeName: "202", postUrl: "https://www.facebook.com/page/posts/123" });
    assert.deepEqual(prepared.comments, ["Перший"]);
    assert.equal(prepared.storyId, "123");
    await assert.rejects(service.selected(["p2"]));
});
