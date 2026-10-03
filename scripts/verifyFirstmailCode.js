import assert from "node:assert/strict";
import Firstmail from "../classes/Firstmail.js";
import extractCode from "../services/mail/extractFacebookConfirmationCode.js";
import prepareWaiter from "../services/mail/prepareFacebookCodeWaiter.js";
import recover from "../facebook/workflows/recoverLockedAccount.js";
import ensureActive from "../workflows/profile/ensureFacebookAccountActive.js";
import { LOGIN_ERROR_TAG_ID } from "../config.js";

const credentials = { login: "mock@example.invalid", password: "mock-password" };
const message = (code = "012345") => ({
    from: { value: [{ address: "security@facebookmail.com" }] },
    to: { value: [{ address: credentials.login }] },
    subject: `${code} is your Facebook security code`,
    text: `Confirm this email address\nTo verify your email address.\n${code}\nDon't share this code with anyone.`,
});
assert.equal(extractCode(message(), credentials.login).code, "012345");
assert.equal(extractCode({ ...message(), text: "Confirm this email address\n0 1 2 3 4 5" }, credentials.login).code, "012345");
assert.equal(extractCode({ ...message(), text: message("654321").text }, credentials.login).reason, "code_ambiguous");
assert.equal(extractCode({ ...message(), subject: "Did you just log in?" }, credentials.login).reason, "subject_mismatch");
assert.equal(extractCode(message(), "other@example.invalid").reason, "recipient_mismatch");
assert.equal(extractCode({ ...message(), from: { value: [{ address: "security@facebookmail.com.evil.invalid" }] } }, credentials.login).reason, "sender_mismatch");

function mailbox() {
    let notify;
    let messages = [];
    let closed = 0;
    let readCount = 0;
    return {
        connect: async () => ({ uidNext: 10, uidValidity: "1" }),
        refreshBaseline: async () => ({ uidNext: 10, uidValidity: "1" }),
        subscribe: (listener) => { notify = listener; return () => { notify = null; }; },
        listNewMessages: async () => messages,
        readMessage: async () => { readCount += 1; return message(); },
        close: () => { closed += 1; },
        deliver(uid) { messages.push({ uid, size: 100, envelope: { from: message().from.value, subject: message().subject } }); notify?.(); },
        get closed() { return closed; }, get reads() { return readCount; },
    };
}
const events = [];
const mail = mailbox();
const waiter = await prepareWaiter({ credentials, mailClient: mail, codeTimeout: 30,
    onStep: (event, details) => events.push({ event, details }) });
waiter.start();
mail.deliver(9);
await new Promise((resolve) => setTimeout(resolve, 3));
assert.equal(mail.reads, 0);
mail.deliver(10);
await new Promise((resolve) => setTimeout(resolve, 45));
assert.equal(await waiter.waitForCode(), "012345");
assert.equal(mail.closed, 1);
assert.equal(JSON.stringify(events).includes("012345"), false);
await assert.rejects(prepareWaiter({ credentials, mailClient: mailbox() }), { code: "FIRSTMAIL_MAILBOX_BUSY" });
waiter.dispose();

const timeoutMail = mailbox();
const timed = await prepareWaiter({ credentials, mailClient: timeoutMail, codeTimeout: 10 });
timed.start();
await assert.rejects(timed.waitForCode(), { code: "FIRSTMAIL_CODE_TIMEOUT" });
assert.equal(timeoutMail.closed, 1);
timed.dispose();
const controller = new AbortController();
const cancelled = await prepareWaiter({ credentials, mailClient: mailbox(), signal: controller.signal });
cancelled.start();
const waiting = cancelled.waitForCode();
controller.abort();
await assert.rejects(waiting, { code: "RECOVERY_ABORTED" });
cancelled.dispose();

const changed = mailbox();
changed.listNewMessages = async () => { throw Object.assign(new Error("mock"), { code: "FIRSTMAIL_UIDVALIDITY_CHANGED" }); };
const invalid = await prepareWaiter({ credentials, mailClient: changed });
invalid.start();
await assert.rejects(invalid.waitForCode(), { code: "FIRSTMAIL_UIDVALIDITY_CHANGED" });
invalid.dispose();

const missing = await recover({ evaluate: () => assert.fail("Не повинно бути DOM-кліків") }, {
    adsPower: { getProfileById: async () => ({ platform_account: [] }) },
    profile: { profile_id: "mock" }, newPassword: "mock-new", onStep: () => {},
});
assert.equal(missing.code, "FIRSTMAIL_CREDENTIALS_NOT_FOUND");

const tags = [];
const profile = { profile_id: "mock", profile_tags: [] };
const active = await ensureActive({
    getProfileById: async () => ({ ...profile, platform_account: [] }),
    updateProfileTags: async (_id, ids, type) => tags.push({ ids, type }),
}, profile, { url: () => "https://www.facebook.com/checkpoint/828281030927956/" }, { onStep: () => {} });
assert.equal(active, false);
assert.deepEqual(tags, [{ ids: [LOGIN_ERROR_TAG_ID], type: "2" }]);

// IMAP-команди тестуються через підставний клієнт без читання реальної пошти.
const queries = [];
const fakeImap = { mailbox: { uidNext: 10, uidValidity: 1n }, on() {}, close() {}, connect: async () => {},
    mailboxOpen: async (_folder, options) => { assert.equal(options.readOnly, true); },
    status: async () => ({ uidNext: 12, uidValidity: 1n }),
    search: async () => [9, 10, 11],
    fetchAll: async (range) => { queries.push(range); return [{ uid: 10 }, { uid: 11 }]; },
};
const transport = new Firstmail(credentials, { clientFactory: () => fakeImap });
await transport.connect();
assert.equal((await transport.listNewMessages(10, "1")).length, 2);
assert.deepEqual(queries, ["10,11"]);
transport.close();
console.log("Firstmail checks passed: parser, UID boundary, buffering, timeout, abort, mailbox lock and Login Error tagging. No live email requests.");
