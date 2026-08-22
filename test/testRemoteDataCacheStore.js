import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import RemoteDataCacheStore
    from "../services/gui/RemoteDataCacheStore.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-cache-test-"));
const cacheFile = path.join(directory, "remote-data.json");
const imagesDirectory = path.join(directory, "images");
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

try {
    const store = new RemoteDataCacheStore({ cacheFile, imagesDirectory });
    await store.setWorkspace("client", {
        pages: [{
            id: "page-1",
            name: "Page",
            pictureUrl: png,
            pageAccessToken: "must-not-be-saved",
        }],
        adAccounts: [{ id: "act_1", name: "Ads" }],
        note: "access_token=must-not-be-saved",
    });
    await store.setPosts("client", "page-1", [{
        id: "page-1_post-1",
        message: "Post",
        thumbnailUrl: png,
        cookie: "must-not-be-saved",
    }]);
    await store.setCampaigns("client", "act_1", "today", {
        campaigns: [{ id: "campaign-1", spend: 10 }],
    });

    const restored = new RemoteDataCacheStore({ cacheFile, imagesDirectory });
    assert.match(
        (await restored.getWorkspace("client")).value.pages[0].pictureUrl,
        /^adsbot-cache:\/\/image\/[a-f0-9]{64}\.png$/
    );
    assert.match(
        (await restored.getPosts("client", "page-1")).value[0].thumbnailUrl,
        /^adsbot-cache:\/\/image\/[a-f0-9]{64}\.png$/
    );
    assert.equal((await readdir(imagesDirectory)).length, 1);
    assert.equal(
        "pageAccessToken" in (await restored.getWorkspace("client")).value.pages[0],
        false
    );
    assert.equal(
        "cookie" in (await restored.getPosts("client", "page-1")).value[0],
        false
    );
    const stableThumbnail = (
        await restored.getPosts("client", "page-1")
    ).value[0].thumbnailUrl;
    await restored.setPosts("client", "page-1", [{
        id: "page-1_post-1",
        message: "Updated without a valid new image",
        thumbnailUrl: null,
    }]);
    assert.equal(
        (await restored.getPosts("client", "page-1")).value[0].thumbnailUrl,
        stableThumbnail
    );

    await restored.prependPost("client", "page-1", {
        id: "page-1_post-2",
        message: "New",
    });
    await restored.removePosts("client", "page-1", [{ id: "page-1_post-1" }]);
    assert.deepEqual(
        (await restored.getPosts("client", "page-1")).value.map((post) => post.id),
        ["page-1_post-2"]
    );

    await restored.invalidateCampaigns("client", "act_1");
    assert.equal(await restored.getCampaigns("client", "act_1", "today"), null);

    const serialized = await readFile(cacheFile, "utf8");
    assert.equal(serialized.includes("must-not-be-saved"), false);
    console.log("Перевірка дискового кешу GUI пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
