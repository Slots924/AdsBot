import assert from "node:assert/strict";

import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";


const requests = [];
let photoUpload = 0;
const proxyHttpClient = {
    async request(config) {
        requests.push(config);
        const pathname = new URL(config.url).pathname.replace("/v26.0", "");
        if (pathname === "/me/accounts") {
            return { data: { data: [{
                id: "10",
                name: "Page",
                tasks: ["MANAGE"],
                access_token: "PAGE_TOKEN",
            }] } };
        }
        if (pathname === "/10" && config.method === "get") {
            return { data: {
                id: "10",
                name: "Page",
                is_published: true,
                ...(String(config.params.fields).includes("created_time")
                    ? { created_time: "2024-01-01T00:00:00+0000" }
                    : {}),
            } };
        }
        if (pathname === "/10/feed" && config.method === "get") {
            return { data: { data: [{
                id: "10_old",
                created_time: "2024-01-01T00:00:00+0000",
                object_id: "old-photo",
                status_type: "added_photos",
            }] } };
        }
        if (pathname === "/10/photos" && config.method === "get") {
            return { data: { data: [{
                id: "old-photo",
                created_time: "2024-01-01T00:00:00+0000",
                album: { id: "album", name: "Timeline photos" },
            }] } };
        }
        if (pathname === "/10/picture" && config.method === "post") {
            assert(config.data.get("source") instanceof Blob);
            return { data: { id: "avatar-new" } };
        }
        if (pathname === "/10/photos" && config.method === "post") {
            photoUpload += 1;
            assert.equal(config.data.get("published"), "false");
            return { data: { id: photoUpload === 1 ? "cover-new" : "post-photo" } };
        }
        if (pathname === "/10" && config.method === "post") {
            assert.equal(config.data.get("cover"), "cover-new");
            return { data: { success: true } };
        }
        if (pathname === "/10_story" && config.method === "post") {
            assert.equal(config.data.get("is_hidden"), "true");
            return { data: { success: true } };
        }
        if (pathname === "/old-photo" && config.method === "delete") {
            return { data: { success: true } };
        }
        if (pathname === "/10/feed" && config.method === "post") {
            assert.deepEqual(
                JSON.parse(config.data.get("attached_media")),
                [{ media_fbid: "post-photo" }]
            );
            assert.equal(config.data.get("published"), "true");
            if (config.data.has("backdated_time")) {
                assert.equal(config.data.get("backdated_time_granularity"), "day");
            } else {
                assert.equal(config.data.has("backdated_time_granularity"), false);
            }
            return { data: { id: "10_post" } };
        }
        if (pathname === "/post-photo" && config.method === "get") {
            return { data: { page_story_id: "10_post" } };
        }
        if (pathname === "/10_post" && config.method === "get") {
            return { data: {
                id: "10_post",
                created_time: "2024-03-01T00:00:00+0000",
                is_published: true,
            } };
        }
        throw new Error(`Неочікуваний mock-запит: ${config.method} ${pathname}`);
    },
};
const api = new FacebookGraphApi({
    accountKey: "client",
    accessToken: "USER_TOKEN",
    cookie: "COOKIE",
    userAgent: "AGENT",
    proxyHttpClient,
});
const image = {
    buffer: Buffer.from("image"),
    filename: "photo.jpg",
    contentType: "image/jpeg",
};

const requirements = await api.getPageRebuildRequirements({ pageId: "10" });
assert.equal(requirements.pageCreatedAt, "2024-01-01T00:00:00+0000");
const snapshot = await api.getPageRebuildSnapshot({ pageId: "10" });
assert.deepEqual(snapshot.posts.map((item) => item.id), ["10_old"]);
assert.deepEqual(snapshot.photos.map((item) => item.id), ["old-photo"]);
assert.equal((await api.setPageProfilePicture({ pageId: "10", image })).photoId, "avatar-new");
assert.equal((await api.setPageCoverPicture({
    pageId: "10",
    image,
    knownPhotoIds: ["old-photo", "avatar-new"],
})).photoId, "cover-new");
assert.equal(await api.hidePagePost({ pageId: "10", postId: "10_story" }), true);
assert.equal(await api.deletePageObject({ pageId: "10", objectId: "old-photo" }), true);
const uploaded = await api.createUnpublishedPagePhoto({ pageId: "10", image });
assert.equal(uploaded.photoId, "post-photo");
const post = await api.createBackdatedPhotoPost({
    pageId: "10",
    photoId: uploaded.photoId,
    backdatedTime: "2024-03-01T00:00:00.000Z",
});
assert.equal(post.postId, "10_post");
const currentPost = await api.createCurrentPhotoPost({
    pageId: "10",
    photoId: uploaded.photoId,
});
assert.equal(currentPost.postId, "10_post");
assert.equal(await api.getPagePhotoStory({ pageId: "10", photoId: "post-photo" }), "10_post");
assert.equal((await api.getPagePostForPage({ pageId: "10", postId: "10_post" })).id, "10_post");
assert(requests.every((request) => !String(request.url).includes("access_token")));
assert(requests.filter((request) => request.method === "post")
    .every((request) => request.headers.Authorization === "Bearer PAGE_TOKEN"));

console.log("Mock-перевірка Graph API пересетаплення пройшла успішно");
