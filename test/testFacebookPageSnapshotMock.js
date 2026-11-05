import assert from "node:assert/strict";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const requests = [];
const downloads = [];
let avatar = "https://scontent.test.fbcdn.net/avatar.jpg";
let thumbnail = "https://scontent.test.fbcdn.net/post.jpg";
let published = true;
let reactions = 4;
let failImages = false;
let finishImages;
let imageGate = Promise.resolve();
const api = new FacebookGraphApi({
    accountKey: "mock", accessToken: "test-token", userAgent: "mock",
    proxyHttpClient: {
        async request(config) {
            const endpoint = new URL(config.url).pathname.replace("/v26.0", "");
            requests.push(endpoint);
            if (endpoint === "/me/accounts") return { data: { data: [{
                id: "10", name: "Page", access_token: "page-secret", tasks: ["CREATE_CONTENT"],
            }] } };
            if (endpoint === "/10") {
                assert.equal(config.params.fields, "id,name,is_published,picture.type(square){url}");
                return { data: { id: "10", name: "Updated page", is_published: published, picture: { data: { url: avatar } } } };
            }
            if (endpoint === "/10/published_posts") return { data: { data: [
                { id: "10_20", message: "https://example.test", full_picture: thumbnail, reactions: { summary: { total_count: reactions } } },
                { id: "10_21", message: "Photo", full_picture: "https://scontent.test.fbcdn.net/second.jpg" },
            ] } };
            throw new Error("Неочікуваний Graph-запит");
        },
        async get(url, config) {
            downloads.push(url);
            assert.equal(config.timeout, 15000);
            await imageGate;
            if (failImages) throw new Error("Зображення недоступне");
            return { data: png, headers: { "content-type": "image/png" } };
        },
    },
});

await api.getPages();
requests.length = 0;
const snapshot = await api.getPageSnapshot({ pageId: "10" });
assert.deepEqual(requests.sort(), ["/10", "/10/published_posts"]);
assert.equal(downloads.length, 0);
assert.equal(snapshot.page.picturePending, true);
assert.equal(snapshot.posts[0].thumbnailPending, true);
assert.equal(snapshot.page.pictureUrl, null);
assert.equal(snapshot.posts[0].reactionCount, 4);
assert.equal(JSON.stringify(snapshot).includes("page-secret"), false);

imageGate = new Promise((resolve) => { finishImages = resolve; });
const pendingImages = api.getPageSnapshotImages(snapshot);
assert.equal(downloads.length, 3);
assert.equal(snapshot.page.name, "Updated page");
finishImages();
const images = await pendingImages;
assert.match(images.page.pictureUrl, /^data:image\/png;base64,/);
assert.equal(images.posts.length, 2);
const previousPage = { ...snapshot.page, ...images.page };
const previousPosts = snapshot.posts.map((post) => ({ ...post, ...images.posts.find((image) => image.id === post.id) }));
reactions = 9;
downloads.length = 0;
requests.length = 0;
const warm = await api.getPageSnapshot({ pageId: "10", previousPage, previousPosts });
assert.equal(requests.length, 2);
assert.equal(warm.posts[0].reactionCount, 9);
assert.equal(warm.page.picturePending, false);
assert.equal(warm.posts.every((post) => !post.thumbnailPending), true);
assert.deepEqual(await api.getPageSnapshotImages(warm), { page: null, posts: [] });
assert.equal(downloads.length, 0);

avatar = "https://scontent.test.fbcdn.net/new-avatar.jpg";
thumbnail = "https://scontent.test.fbcdn.net/new-post.jpg";
const changed = await api.getPageSnapshot({ pageId: "10", previousPage, previousPosts });
assert.equal(changed.page.pictureUrl, previousPage.pictureUrl);
assert.equal(changed.page.picturePending, true);
assert.equal(changed.posts[0].thumbnailPending, true);
assert.equal(changed.posts[1].thumbnailPending, false);
await api.getPageSnapshotImages(changed);
assert.deepEqual(downloads.sort(), [avatar, thumbnail].sort());

failImages = true;
assert.deepEqual(await api.getPageSnapshotImages(changed), { page: null, posts: [] });
published = false;
await assert.rejects(api.getPageSnapshot({ pageId: "10" }), { code: "PAGE_DETAILS_UNPUBLISHED" });
await assert.rejects(api.getPageSnapshot({ pageId: "11" }), { code: "PAGE_DETAILS_ACCESS_DENIED" });
await assert.rejects(api.getPageSnapshot({ pageId: "invalid" }), { code: "PAGE_ID_INVALID" });
console.log("Оновлення фанпейджі: 2 Graph-запити, відкладені зображення та перевикористання кешу — OK");
