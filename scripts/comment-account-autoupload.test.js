import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import setup from "../workflows/accounts/executeCommentAccountAutouploadSetupWithProfile.js";
import FacebookWebClient from "../facebook/api/FacebookWebClient.js";
import prepareSocialContext from "../facebook/autoupload/workflows/prepareSocialContext.js";
import { prepareNameContext, executeNameChange } from "../facebook/autoupload/actions/accounts/changeFacebookName.js";
import changeProfilePicture from "../facebook/autoupload/actions/profile/changeProfilePicture.js";
import changeCoverPhoto from "../facebook/autoupload/actions/profile/changeCoverPhoto.js";
import createTestProfileImage from "./helpers/createTestProfileImage.js";
import { buildCommentAccountSetupMarkdown } from "../services/reports/saveCommentAccountSetupReport.js";

const success = { success: true, outcome: "COMPLETED", message: "Виконано" };
async function fixture(t, overrides = {}, flags = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-comment-http-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("adsbot-comment-http-"));
        await rm(directory, { recursive: true, force: true });
    });
    const files = await Promise.all([1, 2, 3, 4].map(async index => {
        const file = path.join(directory, `${index}.png`);
        await writeFile(file, createTestProfileImage());
        return file;
    }));
    const events = [];
    const action = key => async () => { events.push(key); return success; };
    const options = {
        adsPower: {}, profile: { profile_id: "test", profile_no: "10" },
        persona: { firstName: "Test", lastName: "User", gender: "male" },
        photoSet: { path: directory, files }, random: () => 0.5,
        actions: {
            checkProfileSession: async () => { events.push("session"); return { client: {}, result: { message: "Активний" } }; },
            prepareSocialContext: async () => ({ fbData: {}, context: {} }),
            prepareNameContext: async () => { events.push("accounts-center"); return {}; },
            changeName: action("name"), changeAvatar: action("avatar"), changeCover: action("cover"),
            deletePosts: action("delete"), publishPosts: async (_, { posts }) => {
                assert.equal(posts.length, 1);
                events.push("post", "date");
                return success;
            },
            wait: async milliseconds => events.push(milliseconds),
            updateProfileName: async () => events.push("rename"),
            markGender: async () => events.push("gender"),
            renamePhotoSet: async () => directory,
            markChangeNameError: async () => events.push("name-error-tag"),
            ...overrides,
        }, ...flags,
    };
    return { events, result: await setup(options) };
}

test("HTTP-оформлення чекає між логічними діями, пост і дата разом, після останнього немає паузи", async t => {
    const { result, events } = await fixture(t);
    assert.equal(result.outcome, "success");
    assert.deepEqual(events, ["session", "accounts-center", "name", 30000, "avatar", 30000, "cover", 30000,
        "delete", 30000, "post", "date", 30000, "post", "date", "rename", "gender"]);
});

test("невдала зміна імені ставить тег та зупиняє всі подальші дії", async t => {
    const failure = { success: false, code: "FACEBOOK_NAME_REJECTED", message: "Відмова Facebook", graphUserMessage: "Зачекайте 60 днів" };
    const { result, events } = await fixture(t, { changeName: async () => failure });
    assert.equal(result.outcome, "failed");
    assert.match(result.error, /60 днів/);
    assert.deepEqual(events, ["session", "accounts-center", "name-error-tag"]);
});

test("неактивні cookies не запускають зміни та не призначають стать", async t => {
    const { result, events } = await fixture(t, { checkProfileSession: async () => ({ client: null,
        result: { message: "Facebook потребує авторизації" } }) }, { skipNameChange: true });
    assert.equal(result.outcome, "failed");
    assert.deepEqual(events, []);
});

test("після зміни імені звичайна помилка залишає попередження та дозволяє незалежні дії", async t => {
    const { result, events } = await fixture(t, { changeAvatar: async () => ({ success: false,
        code: "FACEBOOK_GRAPHQL_ERROR", message: "Помилка Facebook", graphCode: 100, graphUserMessage: "Фото недоступне" }) });
    assert.equal(result.outcome, "completed_with_error");
    assert.equal(result.steps.avatar.ok, false);
    assert.match(result.steps.avatar.error, /Фото недоступне/);
    assert.equal(result.steps.cover.ok, true);
    assert.ok(events.includes("post"));
    const markdown = buildCommentAccountSetupMarkdown({ profiles: [result], startedAt: new Date(), finishedAt: new Date() });
    assert.match(markdown, /Фото недоступне/);
    assert.match(markdown, /FB 100/);
    assert.match(markdown, /успішно з попередженнями/);
});

test("скасування під час паузи не запускає наступну дію", async t => {
    const controller = new AbortController();
    const { result, events } = await fixture(t, { wait: async () => controller.abort() }, { signal: controller.signal });
    assert.equal(result.outcome, "failed");
    assert.equal(result.aborted, true);
    assert.ok(!events.includes("avatar"));
});

test("checkpoint і невизначений запис після імені зупиняють наступні кроки без повтору", async t => {
    for (const extra of [{ sessionStatus: "checkpoint" }, { outcomeUnknown: true }]) {
        let attempts = 0;
        const { result, events } = await fixture(t, { changeAvatar: async () => {
            attempts++;
            return { success: false, message: "Зміни зупинено", ...extra };
        } });
        assert.equal(result.outcome, "completed_with_error");
        assert.equal(attempts, 1);
        assert.ok(!events.includes("cover") && !events.includes("delete") && !events.includes("post"));
        assert.equal(result.steps.cover.reason, "Зміни зупинено");
    }
});

test("рандомізація та пропущені дії не створюють зайвих очікувань", async t => {
    const { result, events } = await fixture(t, {}, { random: () => 0, actionDelaySeconds: 12,
        skipAvatarChange: true, skipCoverChange: true, skipDeletePosts: true, skipPublishPosts: true });
    assert.equal(result.outcome, "success");
    assert.equal(events.filter(event => typeof event === "number").length, 0);
    const second = await fixture(t, {}, { random: () => 0, actionDelaySeconds: 12,
        skipCoverChange: true, skipDeletePosts: true, skipPublishPosts: true });
    assert.deepEqual(second.events.filter(event => typeof event === "number"), [7000]);
});

const html = actor => `DTSGInitialData",[],{"token":"mock-dtsg"} LSD",[],{"token":"mock-lsd"} <input name="jazoest" value="2123"> {"sessionId":"mock-session","ACCOUNT_ID":"123","actorID":"${actor}","client_revision":456,"__spin_r":456,"__spin_b":"trunk","__spin_t":789,"comet_env":15}`;
const response = data => ({ status: 200, headers: {}, data: typeof data === "string" ? data : JSON.stringify(data) });
function httpFixture(initialActor = "123") {
    let actor = initialActor;
    const calls = [];
    const client = new FacebookWebClient({ userAgent: "Test", cookies: ["c_user", "xs"].map(name => ({ name,
        value: name === "c_user" ? "123" : "mock-xs", domain: ".facebook.com", path: "/", secure: true })),
        httpClient: { request: async config => {
            calls.push(config);
            if (config.method === "get") return response(html(actor));
            if (config.data instanceof FormData) return response({ payload: { fbid: "555", imageWidth: 800, imageHeight: 400 } });
            const operation = new URLSearchParams(config.data).get("fb_api_req_friendly_name");
            if (operation === "CometProfileSwitchMutation") { actor = "123"; return response(""); }
            if (operation === "FXIMIdentityNameEditorDialogQuery") return response({ data: { fxim_identity_for_id: { canonical_id: "123", screen_rules: { name: { legacy_name_data: { can_change_name: true }, cooldown_status: false } } } } });
            if (operation === "useFXIMNameValidatorQuery") return response({ data: { fx_identity_management: { validate_name_v2: { is_valid: true } } } });
            if (operation === "useFXIMUpdateNameMutation") return response({ data: { fxim_update_identity_name: { error: null } } });
            return response({ data: operation === "ProfileCometProfilePictureSetMutation"
                ? { profile_picture_set: { profile: { id: "123" } } }
                : { user_update_cover_photo: { user: { id: "123" } } } });
        } } });
    return { client, calls };
}

test("соц використовує перший GET, фанка потребує лише перемикання та оновлення контексту", async () => {
    for (const actor of ["123", "999"]) {
        const { client, calls } = httpFixture(actor);
        await client.checkSession();
        const prepared = await prepareSocialContext(client, "test");
        assert.equal(prepared.fbData.actorId, "123");
        assert.equal(calls.filter(call => call.method === "get").length, actor === "123" ? 1 : 2);
        assert.equal(calls.filter(call => call.method === "post").length, actor === "123" ? 0 : 1);
        assert.ok(calls.every(call => !call.url.includes("adsmanager")));
    }
});

test("ім’я, аватар та обкладинка перевикористовують підготовлені контексти без повторного GET", async t => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-comment-http-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        assert.ok(path.basename(directory).startsWith("adsbot-comment-http-"));
        await rm(directory, { recursive: true, force: true });
    });
    const imagePath = path.join(directory, "1.png");
    await writeFile(imagePath, createTestProfileImage());
    const { client, calls } = httpFixture();
    await client.checkSession();
    const { fbData, context } = await prepareSocialContext(client, "test");
    const session = await prepareNameContext(fbData);
    const name = await executeNameChange(fbData, { firstName: "Test", lastName: "User" }, { session });
    assert.equal(name.success, true);
    for (const action of [changeProfilePicture, changeCoverPhoto]) {
        const result = await action(fbData, { imagePath }, { context });
        assert.equal(result.success, true);
    }
    assert.equal(calls.filter(call => call.method === "get").length, 2);
});
