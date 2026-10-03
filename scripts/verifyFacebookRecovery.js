import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import AdsPower from "../classes/AdsPower.js";
import { accountRecovery as config } from "../facebook/selectors/accountRecovery.js";
import { inspectRecoveryInPage } from "../facebook/state/detectAccountRecoveryStep.js";
import recoverLockedAccount from "../facebook/workflows/recoverLockedAccount.js";
import { getFirstmailCredentials, saveRecoveredFacebookPassword, updatePlatformCredentials } from "../services/adspower/profileCredentials.js";

function profileFixture() {
    return { profile_id: "mock-profile", platform: "facebook.com", username: "mock-user", password: "mock-old",
        remark: "Попередні нотатки", platform_account: [
            { domain_name: "https://www.facebook.com/", login_user: "mock-user", password: "mock-old", fakey: "mock-2fa" },
            { domain_name: "firstmail.ltd", login_user: "mock-mail", password: "mock-mail-pass", fakey: "" },
        ] };
}

function clientFixture(failWrites = false) {
    let profile = profileFixture();
    let writes = 0;
    return {
        getProfileById: async () => structuredClone(profile),
        updateProfileCredentials: async (_id, changes) => {
            writes += 1;
            if (failWrites) throw new Error("MOCK_WRITE_FAILURE");
            profile = { ...profile, ...structuredClone(changes) };
        },
        get writes() { return writes; },
    };
}

// Мінімальний DOM відтворює дублікати, реактивні поля та переходи без зовнішніх запитів.
function pageFixture({ changePassword = true, rejectFirstCode = false, protection = true, initial = "GET_STARTED", hostname = "www.facebook.com", authenticatedMarker = true, ancestorAriaHidden = false, startAriaHidden = false, inert = false } = {}) {
    let phase = initial;
    let current;
    let selected = false;
    let rejected = false;
    let submissions = 0;
    let saves = 0;
    const elements = new Map();
    const element = (id, text = "", attrs = {}, hidden = false) => {
        if (!elements.has(id)) elements.set(id, {
            id, textContent: text, innerText: text, attrs, isConnected: true, disabled: false, checked: false, value: "", hidden,
            closest: (selector) => selector === '[aria-hidden="true"]' && ancestorAriaHidden
                ? {} : selector === "[inert]" && inert ? {} : null,
            parentElement: { closest: (selector) => selector === '[aria-hidden="true"]' && ancestorAriaHidden ? {} : null },
            getAttribute(name) { return this.attrs[name] ?? null; },
            getBoundingClientRect() { return { x: 10, y: 10, width: this.hidden ? 0 : 120, height: 40 }; },
            scrollIntoView() {}, querySelectorAll: () => [],
        });
        return elements.get(id);
    };
    const code = element("code");
    const password = element("password");
    const radio = element("radio"); radio.value = "m***@example.invalid";
    const button = (id, label) => element(id, label.toUpperCase(), { "aria-label": label.toUpperCase() });
    const hiddenNext = element("hidden-next", "NEXT", { "aria-disabled": "true", "aria-hidden": "true" }, true);
    const disabledNext = element("disabled-next", "NEXT", { "aria-disabled": "true" });
    const next = button("next", "Next");
    const save = button("save", "Save changes");
    const back = button("back", "Back to Facebook");
    const dialog = element("dialog", config.protectionText.toUpperCase());
    dialog.querySelectorAll = (selector) => selector === config.controls ? [back] : [];
    const query = (selector) => {
        if (selector === config.dialog) return phase === "PROTECTION_DIALOG" ? [dialog] : [];
        if (selector === config.controls) {
            if (phase === "GET_STARTED") {
                const start = button("start", "Get Started");
                start.attrs["aria-hidden"] = startAriaHidden ? "true" : null;
                return [start];
            }
            if (phase === "CHOOSE_EMAIL") return [button("email", "Get a code by email")];
            if (["EMAIL_CONTACT", "CONFIRMATION_CODE", "CURRENT_PASSWORD"].includes(phase)) {
                next.attrs["aria-disabled"] = phase === "EMAIL_CONTACT" && !selected ? "true" : null;
                return [hiddenNext, disabledNext, next];
            }
            if (phase === "NEW_PASSWORD") { save.attrs["aria-disabled"] = password.value ? null : "true"; return [save]; }
            return [];
        }
        if (selector === 'input[type="password"]') return ["NEW_PASSWORD", "CURRENT_PASSWORD"].includes(phase) ? [password] : [];
        if (selector === 'input[type="radio"]') return phase === "EMAIL_CONTACT" ? [radio] : [];
        if (selector === 'input[type="text"], input[type="tel"], input[type="number"]') return phase === "CONFIRMATION_CODE" ? [code] : [];
        if (selector === config.authenticated) return phase === "AUTHENTICATED" && authenticatedMarker ? [element("account")] : [];
        if (selector === '[role="main"], [role="navigation"]') return phase === "AUTHENTICATED" ? [element("main")] : [];
        return [];
    };
    const context = () => ({ URL, config,
        location: { href: phase === "AUTHENTICATED" || phase === "PROTECTION_DIALOG"
            ? `https://${hostname}/` : `https://${hostname}/checkpoint/828281030927956/` },
        document: { readyState: "complete", querySelectorAll: query, body: { innerText:
            phase === "CONFIRMATION_CODE" ? `ENTER CONFIRMATION CODE ${rejected ? "INCORRECT CODE" : ""}`
                : phase === "NEW_PASSWORD" ? "ENTER NEW PASSWORD" : phase === "CURRENT_PASSWORD" ? "ENTER YOUR PASSWORD" : "" } },
        getComputedStyle: (item) => ({ display: item.hidden ? "none" : "block", visibility: "visible", opacity: "1" }),
        window: { innerWidth: 1200, innerHeight: 800 },
    });
    const evaluate = async (fn, ...args) => runInNewContext(`(${fn.toString()})(...args)`, { ...context(), args });
    const snapshot = () => evaluate(inspectRecoveryInPage, config);
    return {
        evaluate,
        evaluateHandle: async (fn, ...args) => {
            const target = await evaluate(fn, ...args);
            current = target;
            const handle = { dispose: async () => {}, asElement: () => target ? handle : null,
                evaluate: async (callback, ...values) => callback(target, ...values),
                boundingBox: async () => target.getBoundingClientRect() };
            return handle;
        },
        isClosed: () => false,
        mouse: { move: async () => {}, down: async () => {}, up: async () => {
            if (current.id === "start") phase = "CHOOSE_EMAIL";
            if (current.id === "email") phase = "EMAIL_CONTACT";
            if (current.id === "radio") { selected = true; radio.checked = true; }
            if (current.id === "next") {
                if (phase === "EMAIL_CONTACT") phase = "CONFIRMATION_CODE";
                else if (phase === "CONFIRMATION_CODE") {
                    submissions += 1;
                    if (rejectFirstCode && submissions === 1) rejected = true;
                    else phase = changePassword ? "NEW_PASSWORD" : protection ? "PROTECTION_DIALOG" : "AUTHENTICATED";
                } else if (phase === "CURRENT_PASSWORD") phase = changePassword ? "NEW_PASSWORD" : "AUTHENTICATED";
            }
            if (current.id === "save") { saves += 1; phase = protection ? "PROTECTION_DIALOG" : "AUTHENTICATED"; }
            if (current.id === "back") phase = "AUTHENTICATED";
        } },
        keyboard: { down: async () => {}, up: async () => {},
            press: async (key) => { if (key === "Backspace") { current.value = ""; rejected = false; } },
            type: async (character) => { current.value += character; } },
        snapshot, get saves() { return saves; }, get submissions() { return submissions; },
    };
}

const client = clientFixture();
assert.equal(getFirstmailCredentials(profileFixture()).login, "mock-mail");
assert.equal(getFirstmailCredentials({ platform_account: [] }), null);
assert.throws(() => getFirstmailCredentials({ platform_account: [{ domain_name: "firstmail.ltd" }] }));
assert.equal((await pageFixture({ initial: "AUTHENTICATED", hostname: "www.facebook.com.evil.example" }).snapshot()).step, "OFFSITE");
assert.equal((await pageFixture({ initial: "AUTHENTICATED", authenticatedMarker: false }).snapshot()).step, "UNKNOWN");
await saveRecoveredFacebookPassword(client, "mock-profile", "mock-new-password");
await saveRecoveredFacebookPassword(client, "mock-profile", "mock-new-password");
const saved = await client.getProfileById();
assert.equal(saved.remark.split("Новий пароль Facebook:").length, 2);
assert.equal(saved.password, "mock-new-password");
assert.deepEqual(saved.platform_account[1], profileFixture().platform_account[1]);
assert.equal(saved.platform_account[0].fakey, "mock-2fa");
await updatePlatformCredentials(client, "mock-profile", "firstmail.ltd", { login: "mock-updated-mail", password: "mock-updated-mail-pass" });
assert.equal((await client.getProfileById()).username, "mock-user");

const page = pageFixture();
assert.equal((await page.snapshot()).step, "GET_STARTED");
assert.equal((await page.snapshot()).controls.start.enabled, 1);
const ariaAncestorPage = pageFixture({ ancestorAriaHidden: true });
const ariaAncestorSnapshot = await ariaAncestorPage.snapshot();
assert.equal(ariaAncestorSnapshot.step, "GET_STARTED");
assert.equal(ariaAncestorSnapshot.controls.start.candidates[0].ancestorAriaHidden, true);
assert.equal((await pageFixture({ startAriaHidden: true }).snapshot()).step, "UNKNOWN");
assert.equal((await pageFixture({ inert: true }).snapshot()).step, "UNKNOWN");
const events = [];
const result = await recoverLockedAccount(ariaAncestorPage, {
    adsPower: clientFixture(), profile: profileFixture(), newPassword: "mock-new-password",
    requestConfirmationCode: async () => "123456", sleep: async () => {}, random: () => 0.5,
    onStep: (event, details) => events.push({ event, details }),
});
assert.equal(result.recovered, true);
assert.equal(result.passwordChanged, true);
assert.equal(result.credentialsSaved, true);
assert.equal(ariaAncestorPage.saves, 1);
assert.equal(JSON.stringify(events).includes("mock-new-password"), false);
assert.equal(JSON.stringify(events).includes("123456"), false);

const autoEvents = [];
let mailConnections = 0;
const autoPage = pageFixture();
const autoResult = await recoverLockedAccount(autoPage, {
    adsPower: clientFixture(), profile: profileFixture(), newPassword: "mock-new-password",
    sleep: async () => {}, onStep: (event, details) => autoEvents.push({ event, details }),
    firstmailClient: {
        connect: async () => { mailConnections += 1; return { uidNext: 10, uidValidity: "1" }; },
        refreshBaseline: async () => ({ uidNext: 10, uidValidity: "1" }),
        subscribe: () => () => {}, close() {},
        listNewMessages: async () => [{ uid: 10, size: 100, envelope: {
            from: [{ address: "security@facebookmail.com" }], subject: "123456 is your Facebook security code",
        } }],
        readMessage: async () => ({ from: { value: [{ address: "security@facebookmail.com" }] },
            to: { value: [{ address: "mock-mail" }] }, subject: "123456 is your Facebook security code",
            text: "Confirm this email address\n123456" }),
    },
});
assert.equal(autoResult.recovered, true);
assert.equal(mailConnections, 1);
assert.ok(autoEvents.findIndex((entry) => entry.event === "mail.listener.ready")
    < autoEvents.findIndex((entry) => entry.event === "click.prepare" && entry.details.action === "next"));
assert.equal(JSON.stringify(autoEvents).includes("123456"), false);

const rejected = pageFixture({ rejectFirstCode: true });
assert.equal((await recoverLockedAccount(rejected, {
    adsPower: clientFixture(), profile: profileFixture(), newPassword: "mock-new-password",
    requestConfirmationCode: async () => "123456", sleep: async () => {}, onStep: () => {},
})).recovered, true);
assert.equal(rejected.submissions, 2);

const noChange = pageFixture({ changePassword: false });
const unchangedClient = clientFixture();
const unchanged = await recoverLockedAccount(noChange, {
    adsPower: unchangedClient, profile: profileFixture(), newPassword: "mock-new-password",
    requestConfirmationCode: async () => "123456", sleep: async () => {}, onStep: () => {},
});
assert.equal(unchanged.recovered, true);
assert.equal(unchanged.passwordChanged, false);
assert.equal(unchangedClient.writes, 0);

const currentPasswordPage = pageFixture({ initial: "CURRENT_PASSWORD", changePassword: false, protection: false });
assert.equal((await recoverLockedAccount(currentPasswordPage, {
    adsPower: clientFixture(), profile: profileFixture(), newPassword: "mock-new-password",
    requestConfirmationCode: async () => "123456",
    sleep: async () => {}, onStep: () => {}, protectionTimeout: 1,
})).recovered, true);
assert.equal(currentPasswordPage.saves, 0);

const noDialogPage = pageFixture({ protection: false });
assert.equal((await recoverLockedAccount(noDialogPage, {
    adsPower: clientFixture(), profile: profileFixture(), newPassword: "mock-new-password",
    requestConfirmationCode: async () => "123456", sleep: async () => {}, onStep: () => {}, protectionTimeout: 1,
})).credentialsSaved, true);

const failedClient = clientFixture(true);
const failedPage = pageFixture();
const failed = await recoverLockedAccount(failedPage, {
    adsPower: failedClient, profile: profileFixture(), newPassword: "mock-new-password",
    requestConfirmationCode: async () => "123456", sleep: async () => {}, onStep: () => {},
});
assert.equal(failed.passwordChanged, true);
assert.equal(failed.credentialsSaved, false);
assert.equal(failed.code, "CREDENTIALS_SAVE_FAILED");
assert.equal(failedPage.saves, 1);
assert.equal(failedClient.writes, 3);

const aborted = new AbortController(); aborted.abort();
assert.equal((await recoverLockedAccount(pageFixture(), {
    adsPower: clientFixture(), profile: profileFixture(), newPassword: "mock-new-password",
    signal: aborted.signal, onStep: () => {},
})).code, "RECOVERY_ABORTED");

const api = new AdsPower();
const requests = [];
api.request = async (method, url, data) => { requests.push({ method, url, data }); return { data: { code: 0 } }; };
await api.updateProfileCredentials("mock-profile", { remark: "mock-note" });
assert.equal(requests.length, 1);
assert.equal(requests[0].method, "post");
assert.equal(requests[0].data.profile_id, "mock-profile");
console.log("Recovery verification passed: DOM, human pointer, OTP retry, credential preservation, save failure and cancellation. No live API requests.");
