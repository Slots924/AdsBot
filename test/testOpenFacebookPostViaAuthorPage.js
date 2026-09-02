import assert from "node:assert/strict";

import openFacebookPostViaAuthorPage, {
    extractFacebookAuthorPageId,
    extractFacebookPostId,
    doesFacebookPostUrlMatch,
    facebookPostViaAuthorPageStatuses,
    firstAuthorPagePostCftSelector,
    firstAuthorPagePostPermalinkSelector,
} from "../facebook/actions/openFacebookPostViaAuthorPage.js";


const pageId = "61592141946590";
const postId = "pfbid08fss2D1EcEbiJm2a5sVUTdwMhcnQ41aJ4iePsnJ7xgRUARXZZrx2cnvMs6rkj9qUl";
const postsUrl = `https://www.facebook.com/${pageId}/posts/${postId}`;
const permalinkUrl = `https://www.facebook.com/permalink.php?story_fbid=${postId}&id=${pageId}`;

assert.equal(extractFacebookAuthorPageId(postsUrl), pageId);
assert.equal(extractFacebookAuthorPageId(permalinkUrl), pageId);
assert.equal(extractFacebookPostId(postsUrl), postId);
assert.equal(extractFacebookPostId(permalinkUrl), postId);
assert.equal(doesFacebookPostUrlMatch(postsUrl, postId), true);
assert.equal(doesFacebookPostUrlMatch(
    "https://www.facebook.com/61592141946590/posts/pfbid-other",
    postId
), false);
assert.equal(extractFacebookAuthorPageId("https://example.com/1/posts/2"), null);
assert.match(firstAuthorPagePostPermalinkSelector, /permalink\.php/);
assert.match(firstAuthorPagePostCftSelector, /__cft__/);
assert.match(firstAuthorPagePostCftSelector, /profile\.php/);

const invalidPageResult = await openFacebookPostViaAuthorPage(null, {
    postUrl: postsUrl,
});
assert.equal(invalidPageResult.success, false);
assert.equal(
    invalidPageResult.status,
    facebookPostViaAuthorPageStatuses.INVALID_INPUT
);

console.log("Mock-перевірка пошуку поста через сторінку автора пройшла успішно");
