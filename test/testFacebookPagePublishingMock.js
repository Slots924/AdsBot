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
                    data: [
                        {
                            id: "page-1",
                            name: "Test Page",
                            tasks: ["CREATE_CONTENT"],
                            access_token: "PAGE_TOKEN",
                        },
                        {
                            id: "page-no-task",
                            name: "No Task Page",
                            tasks: ["MESSAGING"],
                            access_token: "NO_TASK_TOKEN",
                        },
                        {
                            id: "page-unpublished",
                            name: "Unpublished Page",
                            tasks: ["MANAGE"],
                            access_token: "UNPUBLISHED_TOKEN",
                        },
                        {
                            id: "page-forbidden",
                            name: "Forbidden Page",
                            tasks: ["CREATE_CONTENT"],
                            access_token: "FORBIDDEN_TOKEN",
                        },
                    ],
                },
            };
        }

        if (config.url.endsWith("/page-1")) {
            return {
                data: {
                    id: "page-1",
                    name: "Test Page",
                    is_published: true,
                },
            };
        }

        if (config.url.endsWith("/page-unpublished")) {
            return {
                data: {
                    id: "page-unpublished",
                    name: "Unpublished Page",
                    is_published: false,
                },
            };
        }

        if (config.url.endsWith("/page-forbidden")) {
            const error = new Error("Forbidden");
            error.response = {
                status: 403,
                data: {
                    error: {
                        message: "Forbidden",
                        code: 200,
                    },
                },
            };
            throw error;
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
const availabilityRequests = requests.filter(
    ({ config }) => [
        "/page-1",
        "/page-unpublished",
        "/page-forbidden",
    ].some((pathname) => config.url.endsWith(pathname))
);
assert.equal(availabilityRequests.length, 3);
assert(
    availabilityRequests.every(
        ({ config }) =>
            config.headers.Authorization.startsWith("Bearer ")
            && !config.headers.Authorization.includes("USER_TOKEN")
    )
);

const networkFailureClient = new FacebookGraphApi({
    accountKey: "network-failure",
    accessToken: "USER_TOKEN",
    cookie: "TEST_COOKIE",
    userAgent: "TEST_USER_AGENT",
    proxyHttpClient: {
        async request(config) {
            if (config.url.endsWith("/me/accounts")) {
                return {
                    data: {
                        data: [{
                            id: "network-page",
                            name: "Network Page",
                            tasks: ["CREATE_CONTENT"],
                            access_token: "PAGE_TOKEN",
                        }],
                    },
                };
            }

            const error = new Error("Proxy pool exhausted");
            error.code = "PROXY_POOL_EXHAUSTED";
            throw error;
        },
    },
});
await assert.rejects(
    networkFailureClient.getAvailablePages(),
    { code: "PROXY_POOL_EXHAUSTED" }
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

await assert.rejects(
    publishPagePost({
        facebookApiClient,
        pageId: "page-1",
    }),
    { code: "FACEBOOK_POST_VALIDATION_ERROR" }
);
await assert.rejects(
    publishPagePost({
        facebookApiClient,
        pageId: "unknown-page",
        message: "Test",
    }),
    { code: "FACEBOOK_PAGE_NOT_FOUND" }
);

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
