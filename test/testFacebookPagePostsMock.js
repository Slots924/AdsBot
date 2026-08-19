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
                assert.equal(config.params.limit, 10);
                assert.equal("after" in config.params, false);
                return { data: { data: [
                    post("20", "2026-08-20T10:00:00+0000"),
                    post("21", "2026-08-21T10:00:00+0000", {
                        message: "Newest post without website URL",
                    }),
                    post("22", "2026-08-22T10:00:00+0000", {
                        is_published: false,
                    }),
                ] } };
            }
            throw new Error(`Неочікуваний mock-запит: ${config.method} ${path}`);
        },
    },
});

const posts = await api.getPagePosts({ pageId: "10", limit: 10 });
assert.deepEqual(posts.map((item) => item.id), ["10_21", "10_20"]);
assert.equal(posts[0].message, "Newest post without website URL");
assert.match(posts[0].thumbnailUrl, /fbcdn\.net/);
assert.equal(posts.every((item) => !item.pageAccessToken), true);
assert.equal(JSON.stringify(posts).includes("page-secret"), false);
assert.equal(requests.some((request) => String(request.url).includes("access_token")), false);

console.log("Mock-перевірка 10 останніх постів пройшла успішно");
