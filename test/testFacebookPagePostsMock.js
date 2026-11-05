import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";


const requests = [];

function post(id, createdTime, overrides = {}) {
    return {
        id: `10_${id}`,
        message: `Post ${id}`,
        created_time: createdTime,
        is_published: true,
        status_type: "added_photos",
        full_picture: `https://scontent.test.fbcdn.net/${id}.jpg`,
        ...overrides,
    };
}

const api = new FacebookGraphApi({
    accountKey: "client",
    accessToken: "secret",
    cookie: "cookie",
    userAgent: "agent",
    proxyHttpClient: {
        async request(config) {
            requests.push(config);
            const path = new URL(config.url).pathname.replace("/v26.0", "");
            if (path === "/me/accounts") {
                return { data: { data: [{
                    id: "10",
                    name: "Page",
                    tasks: [
                        "PROFILE_PLUS_CREATE_CONTENT",
                        "PROFILE_PLUS_ADVERTISE",
                    ],
                    access_token: "page-secret",
                }] } };
            }
            if (path === "/10" && config.params.fields === "id,name,is_published") {
                return { data: { id: "10", name: "Page", is_published: true } };
            }
            if (path === "/10/published_posts") {
                if (config.params.fields !== "id,message,is_published") {
                    assert.match(config.params.fields, /comments\.filter\(stream\)\.limit\(0\)\.summary\(true\)/);
                    assert.match(config.params.fields, /reactions\.limit\(0\)\.summary\(true\)/);
                }
                assert.equal(config.params.limit, 5);
                assert.equal("after" in config.params, false);
                return { data: { data: [
                    post("20", "2026-08-20T10:00:00+0000", {
                        reactions: { summary: { total_count: 12 } },
                        comments: { summary: { total_count: 30 } },
                        attachments: { data: [{ url: "https://example.test/attachment" }] },
                    }),
                    post("21", "2026-08-21T10:00:00+0000", {
                        message: "x".repeat(600) + " https://example.test/late",
                    }),
                    post("22", "2026-08-22T10:00:00+0000", {
                        is_published: false,
                    }),
                ] } };
            }
            if (path === "/10_20/comments") {
                assert.equal(config.params.limit, 25);
                assert.equal(config.params.filter, "stream");
                assert.equal(config.params.after, "cursor");
                return { data: { data: [{ id: "1", message: "Reply", parent: { id: "2", from: { name: "Parent" } }, reactions: { summary: { total_count: 4 } } }],
                    paging: { next: "https://graph.facebook.com/next?access_token=page-secret", cursors: { after: "next-cursor" } } } };
            }
            throw new Error(`Неочікуваний mock-запит: ${config.method} ${path}`);
        },
    },
});

const posts = await api.getPagePosts({ pageId: "10" });
assert.deepEqual(posts.map((item) => item.id), ["10_21", "10_20"]);
assert.equal(posts[0].message, "x".repeat(600) + " https://example.test/late");
assert.equal(posts[1].reactionCount, 12);
assert.equal(posts[1].commentCount, 30);
assert.equal(requests.some((request) => request.url.endsWith("/comments")), false);
const discussion = await api.getPagePostComments({ pageId: "10", postId: "10_20", after: "cursor" });
assert.equal(discussion.comments[0].parentId, "2");
assert.equal(discussion.comments[0].reactionCount, 4);
assert.equal(discussion.nextCursor, "next-cursor");
assert.equal(JSON.stringify(discussion).includes("page-secret"), false);
await assert.rejects(api.getPagePostComments({ pageId: "10", postId: "11_20" }), { code: "PAGE_POST_ID_INVALID" });
assert.match(posts[0].thumbnailUrl, /fbcdn\.net/);
assert.equal(posts.every((item) => !item.pageAccessToken), true);
assert.equal(JSON.stringify(posts).includes("page-secret"), false);
assert.equal(requests.some((request) => String(request.url).includes("access_token")), false);
const countBeforeSnapshot = requests.filter((request) => request.url.endsWith("/10/published_posts")).length;
const fullSnapshot = await api.getLatestPagePostsWithLinks({ pageId: "10", includeAll: true });
assert.deepEqual(fullSnapshot.map((item) => item.id), ["10_21", "10_20"]);
assert.equal(requests.filter((request) => request.url.endsWith("/10/published_posts")).length, countBeforeSnapshot + 1);

const linkedPosts = await api.getLatestPagePostsWithLinks({ pageId: "10" });
assert.deepEqual(linkedPosts.map((item) => item.id), ["10_21"]);
const signature = await api.getPagePostsSignature({ pageId: "10" });
assert.deepEqual(signature.postIds, ["10_21"]);

console.log("Mock-перевірка 5 останніх постів і повного тексту пройшла успішно");
