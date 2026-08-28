import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";


const requests = [];
const proxyHttpClient = {
    async request(config, options) {
        requests.push({ config, options });
        if (config.url.endsWith("/me/accounts")) {
            return {
                data: {
                    data: [{
                        id: "100",
                        name: "Тестова сторінка",
                        tasks: ["ADVERTISE", "CREATE_CONTENT"],
                        access_token: "PAGE_TOKEN",
                    }],
                },
            };
        }
        if (config.url.endsWith("/100_200") && config.method === "post") {
            assert.equal(
                config.data.get("og_hide_object_attachment"),
                "true"
            );
            return { data: { success: true } };
        }
        if (config.url.endsWith("/100_200")) {
            return {
                data: {
                    id: "100_200",
                    message: "Тест https://offer.example/path",
                    is_published: true,
                    attachments: {
                        data: [{
                            media_type: "photo",
                            media: { image: { src: "https://fbcdn.net/photo.jpg" } },
                        }],
                    },
                },
            };
        }
        if (config.url.endsWith("/100")) {
            return {
                data: {
                    id: "100",
                    name: "Тестова сторінка",
                    is_published: true,
                },
            };
        }
        throw new Error(`Неочікуваний URL: ${config.url}`);
    },
};

const api = new FacebookGraphApi({
    accountKey: "test",
    accessToken: "USER_TOKEN",
    cookie: "TEST_COOKIE",
    userAgent: "TEST_USER_AGENT",
    proxyHttpClient,
});

const result = await api.hidePagePostLinkPreview({
    pageId: "100",
    postId: "200",
});

assert.equal(result.success, true);
assert.equal(result.post.id, "100_200");
assert.equal(result.attachments.length, 1);
assert.equal(result.attachments[0].media_type, "photo");

const updateRequest = requests.find(
    ({ config }) => config.url.endsWith("/100_200") && config.method === "post"
);
assert(updateRequest);
assert.equal(updateRequest.config.headers.Authorization, "Bearer PAGE_TOKEN");
assert.equal(updateRequest.options.retryOnConnectionError, false);

await assert.rejects(
    api.hidePagePostLinkPreview({ pageId: "100", postId: "999_200" }),
    { code: "FACEBOOK_POST_PAGE_MISMATCH" }
);

console.log("Mock-перевірка приховування прев'ю посилання пройшла успішно");
