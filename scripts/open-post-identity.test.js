import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
    normalizeFacebookNumericPostId,
    readOpenedPostIdentityInPage,
} from "../facebook/post/readOpenedPostIdentity.js";

const postId = "122112842157499318";
const currentUrl = "https://www.facebook.com/permalink.php?story_fbid=pfbid-clicked&id=61594979545862";
const story = (id, url) => ({ __typename: "Story", post_id: id, url });

function read(records, { url = currentUrl, visible = true, runtimeAvailable = true } = {}) {
    const source = { getRecordIDs: () => Object.keys(records), get: id => records[id] };
    return runInNewContext(`(${readOpenedPostIdentityInPage.toString()})("dialog")`, {
        URL,
        location: { href: url },
        document: { querySelectorAll: () => visible ? [{ getBoundingClientRect: () => ({ width: 100, height: 100 }) }] : [] },
        getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
        require: () => {
            if (!runtimeAvailable) throw new Error("Runtime відсутній");
            return { getStore: () => ({ getSource: () => source }) };
        },
    });
}

test("нормалізує збережений складений ID і відхиляє pfbid", () => {
    assert.equal(normalizeFacebookNumericPostId(`1437866019399969_${postId}`), postId);
    assert.equal(normalizeFacebookNumericPostId(postId), postId);
    assert.equal(normalizeFacebookNumericPostId("pfbid-original"), null);
    assert.equal(normalizeFacebookNumericPostId("10_20_30"), null);
});

test("визначає числовий ID за URL поточного поста серед інших Story", () => {
    const identity = read({
        other: story("999", "https://www.facebook.com/1/posts/pfbid-other"),
        current: story(postId, currentUrl),
    });
    assert.equal(identity.postId, postId);
    assert.equal(identity.urlPostId, "pfbid-clicked");
});

test("не приймає ID з сусіднього або раніше відкритого поста", () => {
    const identity = read({
        previous: story(postId, "https://www.facebook.com/1/posts/pfbid-previous"),
        current: story("999", currentUrl),
    });
    assert.equal(identity.postId, "999");
    assert.notEqual(identity.postId, postId);
});

test("підтримує URL Story з аргументами Relay", () => {
    assert.equal(read({ current: {
        __typename: "Story", post_id: postId,
        'url(site:"comet")': currentUrl,
    } }).postId, postId);
});

test("не підтверджує пост без діалогу, runtime або однозначного збігу URL", () => {
    const records = { current: story(postId, currentUrl) };
    assert.equal(read(records, { visible: false }), null);
    assert.equal(read(records, { runtimeAvailable: false }), null);
    assert.equal(read({ previous: story(postId, "https://www.facebook.com/1/posts/pfbid-previous") }), null);
    assert.equal(read({ ...records, conflicting: story("999", currentUrl) }), null);
    assert.equal(read(records, { url: "https://example.com/1/posts/pfbid-clicked" }), null);
});
