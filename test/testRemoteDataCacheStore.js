import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
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
    const longMessage = "x".repeat(600) + " https://example.test/late";
    await store.setPosts("client", "text-links", [
        { id: "late-url", message: longMessage },
        { id: "attachment-only", message: "Photo", attachments: { data: [{ url: "https://example.test" }] } },
        ...Array.from({ length: 4 }, (_, index) => ({ id: `other-${index}`, message: "https://example.test" })),
    ], "campaign");
    assert.equal((await store.getPosts("client", "text-links", "campaign")).value.length, 5);
    const textLinks = (await store.getPosts("client", "text-links")).value;
    assert.deepEqual(textLinks.map((post) => post.id), ["late-url", "other-0", "other-1", "other-2"]);
    assert.equal(textLinks[0].message, longMessage);
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
        statisticsUpdatedAt: new Date().toISOString(),
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
        message: "New https://example.test",
    });
    await restored.removePosts("client", "page-1", [{ id: "page-1_post-1" }]);
    assert.deepEqual(
        (await restored.getPosts("client", "page-1")).value.map((post) => post.id),
        ["page-1_post-2"]
    );

    await restored.invalidateCampaigns("client", "act_1");
    assert.equal((await restored.getCampaigns("another-client", "act_1", "today")).value.campaigns[0].spend, 10);

    // Обидва клієнти бачать спільні об'єкти, а їхні дозволи зберігаються окремо.
    await restored.setWorkspace("another-client", { pages: [{ id: "page-1", tasks: ["ADVERTISE"] }], adAccounts: [{ id: "act_1" }] });
    await restored.setWorkspacePart("client", { pages: [{ id: "page-1", name: "Renamed", pictureUrl: null, tasks: ["CREATE_CONTENT"] }] });
    assert.equal((await restored.getWorkspace("another-client")).value.pages[0].name, "Renamed");
    assert.deepEqual((await restored.getWorkspace("another-client")).value.pages[0].tasks, ["ADVERTISE"]);
    assert.match((await restored.getWorkspace("another-client")).value.pages[0].pictureUrl, /^adsbot-cache:/);
    assert.equal((await restored.getPosts("another-client", "page-1")).value[0].id, "page-1_post-2");
    const workspaceRevision = await restored.getWorkspaceRevision();
    await restored.setWorkspacePart("client", { pages: [{ id: "page-1", name: "Fresh name" }] });
    await restored.setWorkspacePart("another-client", { pages: [{ id: "page-1", name: "Late old name" }] }, { expectedRevision: workspaceRevision });
    assert.equal((await restored.getWorkspace("another-client")).value.pages[0].name, "Fresh name");
    await restored.setWorkspacePart("client", { pages: [], adAccounts: [] });
    assert.equal((await restored.getWorkspace("client")).value.pages[0].accessUnavailable, true);
    assert.equal((await restored.getWorkspace("client")).value.adAccounts[0].accessUnavailable, true);
    assert.equal((await restored.getWorkspace("another-client")).value.pages[0].accessUnavailable, undefined);
    await restored.setWorkspacePart("client", { pages: [{ id: "page-1", name: "Fresh name" }], adAccounts: [{ id: "act_1" }] });
    assert.equal((await restored.getWorkspace("client")).value.pages[0].accessUnavailable, false);

    await restored.setPosts("client", "shared-snapshot", [
        { id: "linked", message: "https://example.test", thumbnailUrl: png },
        { id: "plain", message: "Text" },
    ], "campaign");
    assert.equal((await restored.getPosts("another-client", "shared-snapshot", "campaign")).value.length, 2);
    assert.deepEqual((await restored.getPosts("another-client", "shared-snapshot")).value.map((item) => item.id), ["linked"]);
    await restored.prependPost("client", "shared-snapshot", { id: "new-plain", message: "No link" }, { removedPostIds: ["linked"] });
    assert.deepEqual((await restored.getPosts("another-client", "shared-snapshot")).value, []);

    // Точкова зміна та запізніла відповідь не прибирають інші кампанії й метрики.
    const oldRevision = (await restored.getCampaigns("client", "act_1", "today")).value.revision;
    await restored.patchCampaign("another-client", "act_1", { id: "campaign-2", name: "New", status: "PAUSED" });
    assert.equal(await restored.setCampaigns("client", "act_1", "today", { campaigns: [] }, { mode: "list", expectedRevision: oldRevision }), false);
    await restored.patchCampaign("client", "act_1", { id: "campaign-1", name: "Changed", status: "DELETED" });
    assert.equal((await restored.getCampaigns("another-client", "act_1", "yesterday")).value.campaigns.length, 2);
    assert.equal((await restored.getCampaigns("client", "act_1", "today")).value.campaigns[0].spend, 10);

    const oldPostsRevision = await restored.getPostRevision("page-1");
    await restored.prependPost("another-client", "page-1", { id: "page-1_post-3", message: "https://example.test", thumbnailUrl: png });
    assert.equal(await restored.setPosts("client", "page-1", [], "links", { expectedRevision: oldPostsRevision }), false);
    assert.equal((await restored.getPosts("client", "page-1")).value[0].id, "page-1_post-3");

    // Зміна доби в часовому поясі РК зберігає минулі цифри з позначкою застарілості.
    let now = new Date("2026-10-11T20:00:00Z");
    const dated = new RemoteDataCacheStore({ cacheFile: path.join(directory, "dated.json"), now: () => now });
    await dated.setWorkspace("client", { adAccounts: [{ id: "act_2", timezoneName: "Europe/Kyiv" }] });
    await dated.setCampaigns("client", "act_2", "today", { campaigns: [{ id: "c1", spend: 25 }], statisticsUpdatedAt: now.toISOString() });
    assert.deepEqual((await dated.getCampaignContext("act_2", "today")).timeRange, { since: "2026-10-11", until: "2026-10-11" });
    now = new Date("2026-10-11T22:00:00Z");
    const nextDay = (await dated.getCampaigns("other", "act_2", "today")).value;
    assert.equal(nextDay.campaigns[0].spend, 25);
    assert.equal(nextDay.statisticsStale, true);
    assert.equal(nextDay.statisticsRange.timeRange.until, "2026-10-11");
    assert.equal(nextDay.context.timeRange.until, "2026-10-12");
    await dated.patchCampaign("client", "act_2", { id: "c2", name: "Second" });
    await dated.setCampaigns("client", "act_2", "today", { campaigns: [{ id: "c2", spend: 1 }], statisticsUpdatedAt: now.toISOString() }, { mode: "statistics", partial: true });
    const partial = (await dated.getCampaigns("client", "act_2", "today")).value;
    assert.equal(partial.campaigns[0].spend, 25);
    assert.equal(partial.campaigns[1].spend, 1);
    assert.equal(partial.statisticsStale, true);

    // Невдалий запис не змінює останній успішний стан у пам'яті або на диску.
    const diskBeforeFailure = await readFile(cacheFile, "utf8");
    await mkdir(`${cacheFile}.tmp`);
    await assert.rejects(restored.patchCampaign("client", "act_1", { id: "campaign-1", name: "Must not persist" }));
    assert.equal((await restored.getCampaigns("client", "act_1", "today")).value.campaigns[0].name, "Changed");
    assert.equal(await readFile(cacheFile, "utf8"), diskBeforeFailure);
    await rm(`${cacheFile}.tmp`, { recursive: true });

    // Пошкоджений основний файл відновлюється з останньої справної резервної копії.
    await writeFile(cacheFile, "{broken", "utf8");
    const recovered = new RemoteDataCacheStore({ cacheFile, imagesDirectory });
    assert.equal((await recovered.getCampaigns("client", "act_1", "today")).value.campaigns.length, 2);
    await recovered.patchCampaign("client", "act_1", { id: "campaign-2", name: "Recovered" });

    // Міграція об'єднує старі кеші клієнтів і не втрачає кампанії різних періодів.
    const legacyFile = path.join(directory, "legacy.json");
    await writeFile(legacyFile, JSON.stringify({ version: 1, workspaces: {}, posts: {
        "a::p::links": { value: [{ id: "p_1", message: "https://example.test" }], updatedAt: "2026-10-10" },
    }, campaigns: {
        "a::act_3::today": { value: { campaigns: [{ id: "c1", name: "Old", spend: 4 }], statisticsUpdatedAt: "2026-10-10T12:00:00Z" }, updatedAt: "2026-10-10" },
        "b::act_3::yesterday": { value: { campaigns: [{ id: "c1", name: "New", spend: 7 }, { id: "c2" }], statisticsUpdatedAt: "2026-10-11T12:00:00Z" }, updatedAt: "2026-10-11" },
    } }));
    const migrated = new RemoteDataCacheStore({ cacheFile: legacyFile, now: () => new Date("2026-10-11T12:00:00Z") });
    const migrationData = (await migrated.getCampaigns("a", "act_3", "yesterday")).value;
    assert.equal(migrationData.campaigns.length, 2);
    assert.equal(migrationData.campaigns[0].name, "New");
    assert.equal(migrationData.campaigns[0].spend, 7);
    assert.equal((await migrated.getPosts("b", "p")).value[0].id, "p_1");

    const corruptFile = path.join(directory, "corrupt.json");
    await writeFile(corruptFile, JSON.stringify({ version: 2, campaigns: { act_1: { value: { campaigns: "bad" } } } }));
    const corrupt = new RemoteDataCacheStore({ cacheFile: corruptFile });
    await assert.rejects(corrupt.patchCampaign("client", "act_1", { id: "c1" }), { code: "REMOTE_CACHE_READ_FAILED" });
    assert.equal((await readFile(corruptFile, "utf8")).includes('"bad"'), true);

    const serialized = await readFile(cacheFile, "utf8");
    assert.equal(serialized.includes("must-not-be-saved"), false);
    console.log("Перевірка дискового кешу GUI пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
