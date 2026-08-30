import assert from "node:assert/strict";

import FacebookBackendService
    from "../facebook/services/FacebookBackendService.js";
import prepareCreativeForCampaign
    from "../services/creatives/prepareCreativeForCampaign.js";
import loadImageFromPath
    from "../services/images/loadImageFromPath.js";


const activeClient = {
    accountName: "Локальне ім'я",
    facebookUserId: "local-active-id",
    async checkAccessToken() {
        return {
            working: true,
            user: {
                id: "active-id",
                name: "Активний профіль",
            },
        };
    },
    async getAvailablePages() {
        return [{ id: "active-page", name: "Active Page" }];
    },
    async getPagePosts(options) {
        return [{ id: `${options.pageId}_post` }];
    },
};

const inactiveClient = {
    accountName: "Неактивний профіль",
    facebookUserId: "inactive-id",
    async checkAccessToken() {
        return {
            working: false,
            error: {
                message: "Invalid token",
                code: 190,
            },
        };
    },
    async getAvailablePages() {
        return [{ id: "inactive-page", name: "Inactive Page" }];
    },
};

const errorClient = {
    accountName: "",
    facebookUserId: "",
    async checkAccessToken() {
        const error = new Error("Proxy unavailable");
        error.code = "PROXY_POOL_EXHAUSTED";
        throw error;
    },
};

const originalCreative = {
    creative: "Пост <LINK> і ще раз <LINK>",
    comments: [
        { id: "1", text: "Коментар <LINK>" },
        { id: "2", text: "Без посилання" },
    ],
};

const publishedRequests = [];
const loadedImagePaths = [];
const facebookApiClients = new Map([
    ["active", activeClient],
    ["inactive", inactiveClient],
    ["broken", errorClient],
]);

const facebookBackend = await FacebookBackendService.create({
    facebookApiClients,
    creativeManager: {
        async getCreative(geo, creativeName) {
            assert.equal(geo, "HU");
            assert.equal(creativeName, "138");
            return originalCreative;
        },
    },
    imageLoader: async (imagePath) => {
        loadedImagePaths.push(imagePath);
        return {
            buffer: Buffer.from("image"),
            filename: "photo.jpg",
            contentType: "image/jpeg",
        };
    },
    publishPagePostFn: async (request) => {
        publishedRequests.push(request);
        return {
            postId: "page_post",
            pageId: request.pageId,
            type: request.image ? "photo" : "text",
            message: request.message,
            permalinkUrl: "https://facebook.test/post",
            createdTime: "2026-01-01T00:00:00+0000",
            verified: true,
        };
    },
});

const accounts = await facebookBackend.getAccounts();
assert.deepEqual(
    accounts.map(({ accountKey, status }) => ({ accountKey, status })),
    [
        { accountKey: "active", status: "active" },
        { accountKey: "inactive", status: "inactive" },
        { accountKey: "broken", status: "error" },
    ]
);
assert.equal(accounts[0].name, "Активний профіль");
assert.equal(accounts[0].facebookUserId, "active-id");
assert.equal(accounts[2].name, "broken");
assert.equal(accounts[2].error.code, "PROXY_POOL_EXHAUSTED");
assert(
    accounts.every(
        (account) =>
            !("accessToken" in account)
            && !("cookie" in account)
            && !("userAgent" in account)
            && !("proxy" in account)
    )
);

const fanPages = await facebookBackend.getFanPages("active");
assert.deepEqual(
    fanPages,
    [{ id: "active-page", name: "Active Page" }]
);
assert.deepEqual(
    await facebookBackend.getFanPages("inactive"),
    [{ id: "inactive-page", name: "Inactive Page" }]
);
assert.deepEqual(
    await facebookBackend.getPagePosts("active", { pageId: "10" }),
    [{ id: "10_post" }]
);

const preparedCreative = await facebookBackend.prepareCreative({
    geo: "HU",
    creativeName: "138",
    siteUrl: "https://example.com/offer",
});
assert.equal(
    preparedCreative.creative,
    "Пост https://example.com/offer і ще раз https://example.com/offer"
);
assert.equal(
    preparedCreative.comments[0].text,
    "Коментар https://example.com/offer"
);
assert.equal(originalCreative.creative, "Пост <LINK> і ще раз <LINK>");
assert.equal(originalCreative.comments[0].text, "Коментар <LINK>");

assert.throws(
    () => prepareCreativeForCampaign({
        creative: {
            creative: "Текст без маркера",
            comments: [],
        },
        siteUrl: "https://example.com",
    }),
    { code: "CREATIVE_LINK_PLACEHOLDER_NOT_FOUND" }
);
assert.throws(
    () => prepareCreativeForCampaign({
        creative: originalCreative,
        siteUrl: "javascript:alert(1)",
    }),
    { code: "CREATIVE_LINK_VALIDATION_ERROR" }
);

await facebookBackend.publishPost({
    accountKey: "active",
    pageId: "page-1",
    message: "Текст",
});
await facebookBackend.publishPost({
    accountKey: "inactive",
    pageId: "page-2",
    imagePath: "C:/images/photo.jpg",
});
await facebookBackend.publishPost({
    accountKey: "active",
    pageId: "page-3",
    message: "Текст з фото",
    imagePath: "C:/images/photo.jpg",
});

assert.equal(publishedRequests[0].facebookApiClient, activeClient);
assert.equal(publishedRequests[0].image, undefined);
assert.equal(publishedRequests[1].facebookApiClient, inactiveClient);
assert.equal(publishedRequests[1].message, "");
assert.equal(publishedRequests[1].image.contentType, "image/jpeg");
assert.equal(publishedRequests[2].facebookApiClient, activeClient);
assert.equal(publishedRequests[2].message, "Текст з фото");
assert.deepEqual(loadedImagePaths, [
    "C:/images/photo.jpg",
    "C:/images/photo.jpg",
]);

await facebookBackend.publishPost({
    accountKey: "active",
    pageId: "page-4",
    imagePaths: ["C:/images/first.jpg", "C:/images/second.png"],
});
assert.deepEqual(
    publishedRequests.at(-1).images.map((image) => image.filename),
    ["photo.jpg", "photo.jpg"]
);
assert.deepEqual(loadedImagePaths.slice(-2), [
    "C:/images/first.jpg",
    "C:/images/second.png",
]);

await assert.rejects(
    facebookBackend.getFanPages("missing"),
    { code: "FACEBOOK_ACCOUNT_NOT_FOUND" }
);
await assert.rejects(
    loadImageFromPath("C:/images/photo.gif"),
    { code: "FACEBOOK_POST_IMAGE_ERROR" }
);

console.log("Mock-перевірка FacebookBackendService пройшла успішно");
