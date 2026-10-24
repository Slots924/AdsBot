import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import { profileActions, validateProfileAction } from "../facebook/autoupload/actions/profile/index.js";
import createTestProfileImage from "./helpers/createTestProfileImage.js";

const html = 'DTSGInitialData",[],{"token":"mock-dtsg"} LSD",[],{"token":"mock-lsd"} <input name="jazoest" value="2123"> {"sessionId":"mock-session","actorID":"123","client_revision":456,"__spin_r":456,"__spin_b":"trunk","__spin_t":789,"comet_env":15}';
const cookies = ["c_user", "xs"].map(name => ({ name, value: name === "c_user" ? "123" : "mock-xs", domain: ".facebook.com", path: "/", secure: true }));
const response = data => ({ status: 200, headers: {}, data: typeof data === "string" ? data : JSON.stringify(data) });
async function fixture(send) {
    const calls = [];
    const client = new FacebookWebClient({ cookies, userAgent: "Test", httpClient: { request: async (config, options) => {
        calls.push({ config, options });
        if (config.method === "get") return response(html);
        return send(config, options);
    } } });
    await client.checkSession();
    calls.length = 0;
    return { calls, fbData: client.getFbData("test") };
}
async function image(t) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-http-profile-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("adsbot-http-profile-"));
        await rm(directory, { recursive: true, force: true });
    });
    const file = path.join(directory, "neutral.png");
    await writeFile(file, createTestProfileImage());
    return file;
}
const formOf = config => new URLSearchParams(config.data);

test("аватарка й обкладинка використовують multipart через HTTP та поточного соціального actor", async t => {
    const imagePath = await image(t);
    for (const action of ["avatar", "cover"]) {
        const { fbData, calls } = await fixture(config => {
            if (config.data instanceof FormData) {
                assert.equal(config.data.get("av"), "123");
                assert.ok(config.data.get("file") instanceof Blob);
                return response({ payload: { fbid: "555", imageWidth: 800, imageHeight: 400 } });
            }
            const form = formOf(config);
            const input = JSON.parse(form.get("variables")).input;
            assert.equal(input.actor_id, "123");
            return response({ data: action === "avatar" ? { profile_picture_set: { profile: { id: "123" } } } : { user_update_cover_photo: { user: { id: "123" } } } });
        });
        const result = await profileActions[action](fbData, { imagePath });
        assert.equal(result.success, true);
        assert.equal(calls.filter(call => call.config.method === "get").length, 1);
        assert.equal(calls.filter(call => call.config.data instanceof FormData).length, 1);
        assert.ok(calls.filter(call => call.config.method === "post").every(call => call.options.retryOnConnectionError === false));
        assert.ok(!JSON.stringify(result).includes("mock-"));
    }
});

test("Bio щоразу отримує власні свіжі collection та section, базова перевірка їх не запитує", async () => {
    let tokens = 0;
    const { fbData, calls } = await fixture(config => {
        const form = formOf(config);
        if (config.url.includes("bulk-route-definitions")) {
            tokens++;
            const route = form.get("route_urls[0]");
            return response({ payload: { payloads: { [route]: { result: { exports: { rootView: { props: { collectionToken: `collection-${tokens}`, sectionToken: `section-${tokens}`, rawSectionToken: `raw-${tokens}` } } } } } } } });
        }
        const variables = JSON.parse(form.get("variables"));
        assert.equal(variables.collectionToken, `collection-${tokens}`);
        assert.equal(variables.input.bio, tokens === 1 ? "Test Bio" : "");
        return response({ data: { profile_field_save: { id: "123" } } });
    });
    assert.equal(calls.length, 0);
    assert.equal((await profileActions.bio(fbData, { value: "Test Bio" })).success, true);
    assert.equal((await profileActions.bio(fbData, { value: "" })).success, true);
    assert.equal(tokens, 2);
    assert.equal(calls.filter(call => call.config.method === "get").length, 2);
});

test("публікація передає текст і фото, а потім змінює дату створеного story", async t => {
    const imagePath = await image(t);
    const operations = [];
    const { fbData } = await fixture(config => {
        if (config.data instanceof FormData) return response({ payload: { photoID: "555" } });
        const form = formOf(config);
        const operation = form.get("fb_api_req_friendly_name");
        operations.push(operation);
        const variables = JSON.parse(form.get("variables"));
        if (operation === "ComposerStoryCreateMutation") {
            assert.equal(variables.input.message.text, "Test post");
            return response({ data: { story_create: { story: { id: "story-1" } } } });
        }
        assert.equal(operation, "ProfileCometBackdateStoryMutation");
        assert.ok(JSON.stringify(variables).includes("story-1"));
        return response({ data: { story_backdate: { id: "story-1" } } });
    });
    const result = await profileActions["publish-posts"](fbData, { posts: [{ mediaPaths: [imagePath], targetDate: "2025-01-02", text: "Test post" }] });
    assert.equal(result.success, true);
    assert.equal(result.publishedCount, 1);
    assert.equal(result.backdatedCount, 1);
    assert.deepEqual(operations, ["ComposerStoryCreateMutation", "ProfileCometBackdateStoryMutation"]);
});

test("очищення читає Manage Posts, видаляє дозволені story та перевіряє залишок", async () => {
    let reads = 0;
    let writes = 0;
    const { fbData } = await fixture(config => {
        const operation = formOf(config).get("fb_api_req_friendly_name");
        if (operation.endsWith("Query")) {
            const edges = reads++ ? [] : [{ node: { id: "story-1", can_viewer_delete: true } }];
            return response({ data: { user: { timeline_manage_feed_units: { edges, page_info: { has_next_page: false } } } } });
        }
        writes++;
        return response({ data: { story_delete: { id: "story-1" } } });
    });
    const result = await profileActions["clear-posts"](fbData);
    assert.equal(result.success, true);
    assert.equal(result.deletedCount, 1);
    assert.equal(writes, 1);
    assert.equal(reads, 2);
});

test("checkpoint та невідомий результат запису припиняють наступні запити", async t => {
    const imagePath = await image(t);
    for (const checkpoint of [true, false]) {
        const { fbData, calls } = await fixture(config => {
            if (config.data instanceof FormData) return response({ payload: { photoID: "555" } });
            if (checkpoint) return { status: 302, headers: { location: "https://www.facebook.com/checkpoint/" }, data: "" };
            throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
        });
        const result = await profileActions["publish-posts"](fbData, { posts: [1, 2].map(() => ({ mediaPaths: [imagePath], targetDate: "2025-01-02" })) });
        assert.equal(result.success, false);
        assert.equal(result.outcomeUnknown, true);
        assert.equal(result.publishedCount, 0);
        assert.equal(result.postResults[0].created, false);
        if (checkpoint) assert.equal(result.sessionStatus, "checkpoint");
        assert.equal(calls.filter(call => call.config.method === "post").length, 2);
    }
});

test("невдала зміна дати зберігає ID вже опублікованого поста та не публікує його знову", async t => {
    const imagePath = await image(t);
    let creations = 0;
    const { fbData } = await fixture(config => {
        if (config.data instanceof FormData) return response({ payload: { photoID: "555" } });
        const operation = formOf(config).get("fb_api_req_friendly_name");
        if (operation === "ComposerStoryCreateMutation") {
            creations++;
            return response({ data: { story_create: { story: { id: "created-story" } } } });
        }
        return response({ errors: [{ message: "Server error", code: 1357010 }] });
    });
    const result = await profileActions["publish-posts"](fbData, { posts: [{ mediaPaths: [imagePath], targetDate: "2025-01-02" }] });
    assert.equal(result.success, false);
    assert.equal(result.stage, "ProfileCometBackdateStoryMutation");
    assert.equal(result.publishedCount, 1);
    assert.equal(result.backdatedCount, 0);
    assert.equal(result.postResults[0].storyId, "created-story");
    assert.equal(creations, 1);
});

test("валідація захищає від порожньої дії, некоректної дати та непідтвердженого видалення", () => {
    assert.throws(() => validateProfileAction("clear-posts", {}));
    assert.throws(() => validateProfileAction("about", {}));
    assert.throws(() => validateProfileAction("about", { work: { company: "Test" } }));
    assert.throws(() => validateProfileAction("publish-posts", { posts: [{ mediaPaths: ["test.png"], targetDate: "2025-02-30" }] }));
    assert.throws(() => validateProfileAction("bio", { value: "x".repeat(102) }));
    assert.deepEqual(validateProfileAction("bio", { value: "" }), { value: "" });
});

test("About запитує незалежні токени освіти та роботи; MutationQuery не повторюється як читання", async () => {
    const sections = [];
    let currentSection;
    let mutationQueries = 0;
    const { fbData } = await fixture((config, options) => {
        const form = formOf(config);
        if (config.url.includes("bulk-route-definitions")) {
            const route = form.get("route_urls[0]");
            currentSection = new URL(route, "https://www.facebook.com").searchParams.get("sk");
            sections.push(currentSection);
            return response({ payload: { payloads: { [route]: { result: { exports: { rootView: { props: { collectionToken: `collection-${currentSection}`, sectionToken: `section-${currentSection}`, rawSectionToken: `raw-${currentSection}` } } } } } } } });
        }
        const operation = form.get("fb_api_req_friendly_name");
        const variables = JSON.parse(form.get("variables"));
        if (operation === "ProfileCometAboutAppSectionQuery") {
            assert.ok(JSON.stringify(variables).includes(`raw-${currentSection}`));
            return response({ data: { user: { about_app_sections: { nodes: [] } } } });
        }
        if (operation.includes("Typeahead")) return response({ data: { typeahead: { title: "Test", fbid: "456", value: "Test" } } });
        assert.equal(options.retryOnConnectionError, false);
        if (operation.includes("EducationExperienceSaveMutationQuery")) {
            mutationQueries++;
            assert.ok(!variables.input.logging_data?.nav_chain);
        }
        return response({ data: { saved: true } });
    });
    const result = await profileActions.about(fbData, { education: "Test College", work: { company: "Test Company", position: "Test Job" } });
    assert.equal(result.success, true);
    assert.deepEqual(sections, ["directory_education", "directory_work"]);
    assert.equal(mutationQueries, 1);
    assert.ok(!JSON.stringify(result).includes("collection-directory"));
});

test("HTTP 200 без підтвердження mutation не позначається успіхом", async () => {
    const { fbData } = await fixture(config => {
        const form = formOf(config);
        if (config.url.includes("bulk-route-definitions")) {
            const route = form.get("route_urls[0]");
            return response({ payload: { payloads: { [route]: { result: { exports: { rootView: { props: { collectionToken: "collection", sectionToken: "section" } } } } } } } });
        }
        return response({ data: {} });
    });
    const result = await profileActions.bio(fbData, { value: "Test" });
    assert.equal(result.success, false);
    assert.equal(result.outcomeUnknown, true);
});
