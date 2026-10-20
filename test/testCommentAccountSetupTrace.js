import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import executeCommentAccountSetupWithProfile from "../workflows/accounts/executeCommentAccountSetupWithProfile.js";
import { getBrowserTrace } from "../services/logging/browserTraceContext.js";
import { inspectTraceDom } from "../facebook/browser/inspectTraceDom.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-setup-trace-"));
try {
    const image = Buffer.alloc(40);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(image);
    image.writeUInt32BE(400, 16);
    image.writeUInt32BE(200, 20);
    const files = [1, 2, 3].map((index) => path.join(directory, `${index}.png`));
    await Promise.all(files.map((file) => writeFile(file, image)));
    let disconnected = false;
    const page = { url: () => "https://www.facebook.com/me", async evaluate(callback) {
        assert.equal(disconnected, false);
        if (callback === inspectTraceDom) return { elements: [], dialogs: [], readyState: "interactive" };
    } };
    const visited = [];
    const action = (id, result) => async (targetPage, options) => {
        assert.equal(targetPage, page);
        assert.equal(getBrowserTrace(page).currentStep, id);
        visited.push(id);
        await options.onProgress?.({ type: `${id}.finished`, status: result.status });
        return result;
    };
    const result = await executeCommentAccountSetupWithProfile({
        traceDirectory: path.join(directory, "traces"),
        adsPower: { openProfile: async () => ({ ws: {} }), closeProfile: async () => {} },
        profile: { profile_no: "test", profile_id: "test", profile_tags: [] },
        persona: { gender: "male", firstName: "Fixture", lastName: "Person", bio: "Fixture bio",
            work: { company: "Fixture company", position: "Fixture role" }, education: "Fixture college" },
        photoSet: { path: directory, files },
        actions: {
            ensureAdsPowerReady: async () => true,
            connectBrowser: async () => ({ pages: async () => [page], disconnect() { disconnected = true; } }),
            configureBrowserWindow: async () => ({}), openPage: async () => {},
            ensureLoggedIn: async () => true, ensureActive: async () => true, ensureEnglish: async () => {},
            changeName: action("name", { success: true, status: "CHANGED" }),
            changeAvatar: action("avatar", { success: true, status: "CHANGED" }),
            changeCover: action("cover", { success: true, status: "CHANGED" }),
            deletePosts: action("delete-posts", { success: true, status: "CLEANED", deletedCount: 1 }),
            publishPosts: action("publish-posts", { success: true, status: "COMPLETED", publishedCount: 1 }),
            fillAbout: action("about", { success: false, status: "PARTIAL", fields: {
                bio: { status: "CLEARED" }, work: { status: "FILLED" },
                education: { status: "FAILED", error: { message: "Missing college button" } },
            } }),
            updateProfileName: async () => {}, markGender: async () => {}, renamePhotoSet: async () => directory,
        },
    });
    assert.deepEqual(visited, ["name", "avatar", "cover", "delete-posts", "publish-posts", "about"]);
    assert.equal(result.outcome, "completed_with_error");
    assert.equal(result.steps.about.fields.work.success, true);
    assert.equal(result.steps.about.fields.education.success, false);
    assert.equal(result.steps.about.fields.education.error, "Missing college button");
    assert.equal(disconnected, true);
    assert.equal(getBrowserTrace(page), undefined);
    assert.match(await readFile(result.browserTracePath, "utf8"), /about: failed/);
    const events = (await readFile(path.join(path.dirname(result.browserTracePath), "events.jsonl"), "utf8"))
        .trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.filter((event) => event.type === "step.started").map((event) => event.step), visited);
    assert.doesNotMatch(JSON.stringify(events), /Fixture Person|Fixture college|Fixture company/);
} finally {
    await rm(directory, { recursive: true, force: true });
}
console.log("Comment account setup trace integration tests passed");
