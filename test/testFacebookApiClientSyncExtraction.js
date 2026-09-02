import assert from "node:assert/strict";

import { extractFacebookAccessTokenFromHtml }
    from "../facebook/workflows/syncFacebookApiClientFromAdsPowerProfile.js";


const token = "EAA".padEnd(28, "a");
assert.equal(
    extractFacebookAccessTokenFromHtml(`{"accessToken":"${token}"}`),
    token
);
assert.equal(extractFacebookAccessTokenFromHtml("<html></html>"), "");
console.log("Перевірка пошуку access token у DOM пройшла успішно");
