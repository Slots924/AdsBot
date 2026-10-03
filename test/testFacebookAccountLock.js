import assert from "node:assert/strict";

import isAccountLocked from "../facebook/state/checks/isAccountLocked.js";
import detectFacebookState from "../facebook/state/detectFacebookState.js";
import ensureFacebookAccountActive from "../workflows/profile/ensureFacebookAccountActive.js";


const lockedUrl = "https://www.facebook.com/checkpoint/828281030927956/?next=https%3A%2F%2Fwww.facebook.com%2F#";
for (const url of [lockedUrl, "https://www.facebook.com/checkpoint/828281030927956"]) {
    assert.equal(await isAccountLocked({ url: () => url }), true);
}
for (const url of [
    "https://www.facebook.com/checkpoint/123456/",
    "https://www.facebook.com/checkpoint/8282810309279560/",
    "https://www.facebook.com/checkpoint/828281030927956/extra",
    "https://www.facebook.com/?next=/checkpoint/828281030927956",
    "https://example.com/checkpoint/828281030927956/",
    "https://www.facebook.com.example.com/checkpoint/828281030927956/",
    "about:blank",
    "invalid",
]) {
    assert.equal(await isAccountLocked({ url: () => url }), false, url);
}

const lockedPage = {
    url: () => lockedUrl,
    evaluate: async () => {
        assert.fail("ACCOUNT_LOCK має визначатися до перевірок DOM");
    },
};
assert.equal(await detectFacebookState(lockedPage), "ACCOUNT_LOCK");
assert.equal(await detectFacebookState({
    url: () => "https://www.facebook.com/checkpoint/123456/",
    evaluate: async () => false,
}), "BANNED");
assert.equal(await detectFacebookState({
    url: () => "https://www.facebook.com/",
    evaluate: async () => ({ step: "AUTHENTICATED" }),
}), "READY");

const messages = [];
const originalLog = console.log;
console.log = (...args) => messages.push(args.join(" "));
try {
    const adsPower = {
        updateProfile: async () => assert.fail("ACCOUNT_LOCK не повинен додавати BAN"),
        updateProfileTags: async (_id, tags) => assert.equal(tags.includes("1464743"), true),
    };
    assert.equal(await ensureFacebookAccountActive(adsPower, {}, lockedPage), false);
} finally {
    console.log = originalLog;
}
assert.equal(messages.some((message) => message.includes("recovery.failed")), true);
assert.equal(messages.some((message) => message.includes("Стан Facebook після fixAccountLock: ACCOUNT_LOCK")), true);

console.log("Facebook account lock tests passed");
