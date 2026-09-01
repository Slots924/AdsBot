import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import rebuildPageFromFolder
    from "../facebook/workflows/rebuildPageFromFolder.js";
import PageRebuildJournal
    from "../services/workflows/PageRebuildJournal.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-page-workflow-"));
const jobsFile = path.join(directory, "jobs.json");
const journal = new PageRebuildJournal({ jobsFile });
const calls = {
    avatar: 0,
    cover: 0,
    upload: [],
    publish: [],
    currentPublish: [],
    delete: [],
    hide: [],
};
let snapshotCalls = 0;
let failSecondPost = true;
const facebookApiClient = {
    async getPageRebuildRequirements() {
        return { pageCreatedAt: "2024-01-01T00:00:00.000Z" };
    },
    async getPageRebuildSnapshot() {
        snapshotCalls += 1;
        return snapshotCalls === 1
            ? {
                posts: [{ id: "10_old", story: "", objectId: "old-photo" }],
                photos: [{ id: "old-photo" }],
            }
            : {
                posts: [
                    { id: "10_old", story: "", objectId: "old-photo" },
                    { id: "10_avatar", story: "Changed avatar", objectId: "avatar-new" },
                    { id: "10_cover", story: "Changed cover", objectId: "cover-new" },
                ],
                photos: [
                    { id: "old-photo" },
                    { id: "avatar-new" },
                    { id: "cover-new" },
                ],
            };
    },
    async setPageProfilePicture() {
        calls.avatar += 1;
        return { photoId: "avatar-new" };
    },
    async setPageCoverPicture() {
        calls.cover += 1;
        return { photoId: "cover-new" };
    },
    async hidePagePost({ postId }) {
        calls.hide.push(postId);
        return true;
    },
    async deletePageObject({ objectId }) {
        calls.delete.push(objectId);
        return true;
    },
    async createUnpublishedPagePhoto({ image }) {
        calls.upload.push(image.filename);
        return { photoId: `photo-${image.filename}` };
    },
    async createBackdatedPhotoPost({ photoId }) {
        calls.publish.push(photoId);
        if (photoId === "photo-post-2.jpg" && failSecondPost) {
            failSecondPost = false;
            const error = new Error("temporary");
            error.code = "FACEBOOK_API_ERROR";
            throw error;
        }
        return { postId: `10_${photoId}` };
    },
    async createCurrentPhotoPost({ photoId }) {
        calls.currentPublish.push(photoId);
        return { postId: `10_current_${photoId}` };
    },
    async getPagePostForPage({ postId }) {
        return { id: postId };
    },
    async getPagePhotoStory() {
        return null;
    },
};
const prepare = async () => ({
    fingerprint: "same-folder",
    imagesDirectory: "C:/images",
    avatar: { absolutePath: "C:/images/1.jpg", filename: "1.jpg" },
    cover: { absolutePath: "C:/images/2.jpg", filename: "2.jpg" },
    posts: [
        { absolutePath: "C:/images/post-1.jpg", filename: "post-1.jpg" },
        { absolutePath: "C:/images/post-2.jpg", filename: "post-2.jpg" },
    ],
});
const imageLoader = async (file) => ({
    buffer: Buffer.from("image"),
    filename: path.basename(file),
    contentType: "image/jpeg",
});
const createSchedule = () => [
    "2024-02-01T00:00:00.000Z",
    "2024-03-01T00:00:00.000Z",
];

try {
    await assert.rejects(rebuildPageFromFolder({
        facebookApiClient,
        journal,
        accountKey: "client",
        pageId: "10",
        imagesDirectory: "C:/images",
        prepare,
        imageLoader,
        createSchedule,
    }), { code: "FACEBOOK_API_ERROR" });

    const result = await rebuildPageFromFolder({
        facebookApiClient,
        journal,
        accountKey: "client",
        pageId: "10",
        imagesDirectory: "C:/images",
        prepare,
        imageLoader,
        createSchedule,
    });
    assert.equal(result.resumed, true);
    assert.equal(result.publications.length, 2);
    assert.equal(calls.avatar, 1);
    assert.equal(calls.cover, 1);
    assert.deepEqual(calls.upload, ["post-1.jpg", "post-2.jpg"]);
    assert.equal(calls.publish.filter((id) => id === "photo-post-1.jpg").length, 1);
    assert.equal(calls.publish.filter((id) => id === "photo-post-2.jpg").length, 2);
    assert.deepEqual(calls.hide, []);
    assert.deepEqual(new Set(calls.delete), new Set(["old-photo", "10_old"]));

    const preservedDatesResult = await rebuildPageFromFolder({
        facebookApiClient,
        journal,
        accountKey: "client",
        pageId: "10",
        imagesDirectory: "C:/images",
        preserveDates: true,
        prepare,
        imageLoader,
        createSchedule: () => {
            throw new Error("Розклад не має створюватися, коли дати збережено");
        },
    });
    assert.deepEqual(calls.currentPublish, ["photo-post-1.jpg", "photo-post-2.jpg"]);
    assert(preservedDatesResult.publications.every((item) => item.backdatedTime === null));

    const journalText = await readFile(jobsFile, "utf8");
    assert(!journalText.includes("accessToken"));
    assert(!journalText.includes("cookie"));
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Mock-перевірка workflow пересетаплення пройшла успішно");
