import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { withFacebookRuntime } from "./helpers/facebookRuntimePage.js";
import { facebookTranslations, getFacebookTexts } from "../facebook/i18n/index.js";
import changeFanPageName from "../facebook/api-actions/pages/changeFanPageName.js";

const requireFrontend = createRequire(new URL("../frontend/package.json", import.meta.url));
const { JSDOM } = requireFrontend("jsdom");
const name = "Test Latin Name";
const password = "mock-password-only";
const nameEndpoint = "/ajax/settings/account/name.php";
const previewEndpoint = "/settings/name_change_preview/";
const submitted = {
    payload: true,
    jsmods: { require: [["SettingsController", "closeAndAnimateEdited", [], []]] },
};

function formResponse(action, { preview = false, requestedName = name, duplicate = false } = {}) {
    const form = `<form action="${action}" method="post">
        <input name="pseudonymous_name" value="${requestedName}">
        <input type="hidden" name="cquick_token" value="mock-form-secret">
        <input type="hidden" name="cquick" value="test-quick">
        ${preview ? '<input type="password" name="save_password">' : ""}
        <p>You cannot change your name for 60 days.</p>
    </form>`;
    return { payload: true, jsmods: { markup: [["form-markup", { __html: form + (duplicate ? form : "") }]] } };
}

function validationResponse(html, { id = "dynamic-error-482", missingMarkup = false } = {}) {
    return {
        ...submitted,
        jsmods: {
            require: [
                ...submitted.jsmods.require,
                ["SettingsController", "showError", [], ["name", { __m: id }]],
            ],
            markup: [
                ["unrelated", { __html: "Do not use this name for 60 days" }],
                ...(!missingMarkup ? [[id, { __html: html }]] : []),
            ],
        },
    };
}

// Виконує справжні browser callbacks у DOM, перехоплюючи лише мережу та runtime.
function createPage({ final = submitted, initial, preview, mutateActor = false, failFinal = false } = {}) {
    const dom = new JSDOM("", { url: "https://www.facebook.com/some-page", runScripts: "outside-only" });
    const calls = [];
    const runtime = { av: "100", __user: "100" };
    dom.window.fetch = async (url, options = {}) => {
        const current = new URL(String(url), dom.window.location.origin);
        const fields = new URLSearchParams(options.body ?? current.search);
        calls.push({ path: current.pathname, method: options.method || "GET", fields });
        const index = calls.length - 1;
        if (index === 2 && failFinal) throw new dom.window.DOMException("mock timeout", "AbortError");
        const payload = index === 0 ? (initial ?? formResponse(previewEndpoint))
            : index === 1 ? (preview ?? formResponse(nameEndpoint, { preview: true })) : final;
        if (index === 1 && mutateActor) runtime.av = "200";
        const httpStatus = payload.httpStatus ?? 200;
        return {
            ok: httpStatus >= 200 && httpStatus < 300,
            status: httpStatus,
            text: async () => payload.raw ?? ` \nfor (;;);${JSON.stringify(payload)}`,
        };
    };
    const page = withFacebookRuntime({
        url: () => dom.window.location.href,
        async evaluate(callback, argument) {
            dom.window.argument = argument;
            return dom.window.eval(`(${callback.toString()})(argument)`);
        },
    }, { runtime });
    return { page, calls, close: () => dom.window.close() };
}

async function run(options = {}, input = {}) {
    const mock = createPage(options);
    try {
        const result = await changeFanPageName({ page: mock.page, name, password, timeout: 1000, ...input });
        const serialized = JSON.stringify(result);
        for (const secret of [password, "mock-form-secret", "lsd-token"]) {
            assert(!serialized.includes(secret), "Секрет не повинен потрапляти до результату");
        }
        return { result, calls: mock.calls };
    } finally { mock.close(); }
}

const success = await run({}, { additionalProfileId: "100" });
assert.equal(success.result.success, true);
assert.equal(success.result.status, "REQUEST_SUBMITTED");
assert.equal(success.result.stage, "SUBMIT");
assert.deepEqual(success.result.data, { name });
assert.deepEqual(success.calls.map(({ path, method }) => [path, method]), [
    [nameEndpoint, "GET"], [previewEndpoint, "POST"], [nameEndpoint, "POST"],
]);
assert.equal(success.calls[1].fields.get("pseudonymous_name"), name);
assert.equal(success.calls[1].fields.has("save_password"), false);
assert.equal(success.calls[2].fields.get("save_password"), password);
assert.equal(success.calls[2].fields.get("cquick_token"), "mock-form-secret");

const forbidden = await run({ final: validationResponse(
    "<b>Creating content with this name is not allowed.</b> Try another name."
) });
assert.equal(forbidden.result.status, "NAME_NOT_ALLOWED");
assert.equal(forbidden.result.success, false);
assert.equal(forbidden.result.error, "Creating content with this name is not allowed. Try another name.");
assert.equal(forbidden.calls.length, 3);

// Перевіряє всі мови, інший регістр і нормалізацію пробілів.
for (const dictionary of Object.values(facebookTranslations)) {
    const phrase = dictionary.pageNameChange.nameNotAllowed[0];
    const { result } = await run({ final: validationResponse(phrase.toUpperCase().replaceAll(" ", "   ")) });
    assert.equal(result.status, "NAME_NOT_ALLOWED");
}
assert.equal(getFacebookTexts("pageNameChange.nameNotAllowed").length, 9);

const other = await run({ final: validationResponse("<p>Incorrect password.</p><script>secret code</script>") });
assert.equal(other.result.status, "FACEBOOK_VALIDATION_ERROR");
assert.equal(other.result.error, "Incorrect password.");
assert(!other.result.error.includes("60 days"));
const missing = await run({ final: validationResponse("", { missingMarkup: true }) });
assert.equal(missing.result.status, "FACEBOOK_VALIDATION_ERROR");
const redacted = await run({ final: validationResponse(`Rejected ${password} mock-form-secret lsd-token`) });
assert(redacted.result.error.includes("[REDACTED]"));

for (const final of [
    { payload: true },
    { ...submitted, payload: false },
    { payload: true, jsmods: { require: "unexpected" } },
]) {
    const unknown = await run({ final });
    assert.equal(unknown.result.status, "UNKNOWN_RESPONSE");
    assert.equal(unknown.result.success, false);
    assert.equal(unknown.calls.length, 3);
}

const topError = await run({ final: { ...submitted, error: 123, errorDescription: "<p>Permission denied.</p>" } });
assert.equal(topError.result.status, "FACEBOOK_ERROR");
assert.equal(topError.result.error, "Permission denied.");
const invalidJson = await run({ final: { raw: "<html>login</html>" } });
assert.equal(invalidJson.result.status, "PARSE_ERROR");
const nullJson = await run({ final: { raw: "null" } });
assert.equal(nullJson.result.status, "PARSE_ERROR");
const httpError = await run({ final: { httpStatus: 500, raw: "unavailable" } });
assert.equal(httpError.result.status, "HTTP_ERROR");
const timeout = await run({ failFinal: true });
assert.equal(timeout.result.status, "REQUEST_TIMEOUT");
assert.equal(timeout.result.stage, "SUBMIT");
assert.equal(timeout.calls.length, 3);

for (const preview of [
    formResponse(nameEndpoint, { preview: true, requestedName: "Other Name" }),
    formResponse(nameEndpoint),
    formResponse(nameEndpoint, { preview: true, duplicate: true }),
    formResponse("https://example.com/ajax/settings/account/name.php", { preview: true }),
]) {
    const invalid = await run({ preview });
    assert.equal(invalid.result.status, "UNEXPECTED_FORM");
    assert.equal(invalid.calls.length, 2);
}
const previewError = await run({ preview: validationResponse("Name cannot be changed.") });
assert.equal(previewError.result.status, "FACEBOOK_VALIDATION_ERROR");
assert.equal(previewError.result.stage, "PREVIEW");
assert.equal(previewError.calls.length, 2);
const actorChanged = await run({ mutateActor: true });
assert.equal(actorChanged.result.status, "ACTOR_CHANGED");
assert.equal(actorChanged.calls.length, 2);
const wrongActor = await run({}, { additionalProfileId: "200" });
assert.equal(wrongActor.result.status, "ACTOR_CHANGED");
assert.equal(wrongActor.calls.length, 0);
const invalidInput = await run({}, { name: " " });
assert.equal(invalidInput.result.status, "INVALID_INPUT");
assert.equal(invalidInput.calls.length, 0);

console.log("Перевірка Facebook action зміни назви Fan Page пройшла успішно");
