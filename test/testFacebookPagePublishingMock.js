import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import publishPagePost from "../facebook/workflows/publishPagePost.js";
import ProxyHttpClient from "../services/proxy/ProxyHttpClient.js";


const requests = [];

const proxyHttpClient = {
    async request(config, options) {
        requests.push({ config, options });

        if (config.url.endsWith("/me/accounts")) {
            return {
                data: {
                    data: [{
                        id: "page-1",
                        name: "Test Page",
                        tasks: ["CREATE_CONTENT"],
                        access_token: "PAGE_TOKEN",
                    }],
                },
            };
        }

        if (config.url.endsWith("/page-1/feed")) {
            return { data: { id: "page-1_text-post" } };
        }

        if (config.url.endsWith("/page-1/photos")) {
            return { data: { id: "photo-1" } };
        }

        if (config.url.endsWith("/photo-1")) {
            return {
                data: { page_story_id: "page-1_photo-post" },
            };
        }

        if (config.url.endsWith("/page-1_text-post")) {
            return {
                data: {
                    id: "page-1_text-post",
                    message: "Текстовий пост",
                    created_time: "2026-01-01T00:00:00+0000",
                    permalink_url: "https://facebook.test/text-post",
                    is_published: true,
                },
            };
        }

        if (config.url.endsWith("/page-1_photo-post")) {
            return {
                data: {
                    id: "page-1_photo-post",
                    message: "Фотопост",
                    created_time: "2026-01-01T00:00:00+0000",
                    permalink_url: "https://facebook.test/photo-post",
                    is_published: true,
                },
            };
        }

        throw new Error(`Неочікуваний URL: ${config.url}`);
    },
};

const facebookApiClient = new FacebookGraphApi({
    accountKey: "test",
    accessToken: "USER_TOKEN",
    cookie: "TEST_COOKIE",
    userAgent: "TEST_USER_AGENT",
    proxyHttpClient,
});

assert.deepEqual(
    await facebookApiClient.getAvailablePages(),
    [{ id: "page-1", name: "Test Page" }]
);

const textResult = await publishPagePost({
    facebookApiClient,
    pageId: "page-1",
    message: "Текстовий пост",
});

assert.equal(textResult.postId, "page-1_text-post");
assert.equal(textResult.verified, true);

const photoResult = await publishPagePost({
    facebookApiClient,
    pageId: "page-1",
    message: "Фотопост",
    image: {
        buffer: Buffer.from("fake-image"),
        filename: "photo.jpg",
        contentType: "image/jpeg",
    },
});

assert.equal(photoResult.postId, "page-1_photo-post");
assert.equal(photoResult.verified, true);

const postRequests = requests.filter(
    ({ config }) => config.method === "post"
);

assert.equal(postRequests.length, 2);
assert(
    postRequests.every(
        ({ options }) => options.retryOnConnectionError === false
    )
);
assert(
    postRequests.every(
        ({ config }) =>
            config.headers.Authorization === "Bearer PAGE_TOKEN"
    )
);
assert(
    postRequests.some(
        ({ config }) => config.url.endsWith("/page-1/feed")
    )
);
assert(
    postRequests.some(
        ({ config }) => config.url.endsWith("/page-1/photos")
    )
);

let failedPostAttempts = 0;
const proxyClient = new ProxyHttpClient({
    proxies: [
        {
            id: "proxy-1",
            type: "socks5",
            host: "127.0.0.1",
            port: 10001,
        },
        {
            id: "proxy-2",
            type: "socks5",
            host: "127.0.0.1",
            port: 10002,
        },
    ],
    httpClient: {
        async request() {
            failedPostAttempts += 1;
            const error = new Error("Connection reset");
            error.code = "ECONNRESET";
            error.request = {};
            throw error;
        },
    },
    checkProxyFn: async () => ({ working: true }),
});

await assert.rejects(
    proxyClient.request({
        method: "post",
        url: "https://graph.facebook.test/page/feed",
    }, {
        retryOnConnectionError: false,
    }),
    { code: "PROXY_REQUEST_OUTCOME_UNKNOWN" }
);
assert.equal(failedPostAttempts, 1);

console.log("Mock-перевірка публікації пройшла успішно");
