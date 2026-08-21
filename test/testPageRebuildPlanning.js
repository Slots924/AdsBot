import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import createBackdatedSchedule
    from "../services/pageRebuild/createBackdatedSchedule.js";
import preparePageRebuild
    from "../services/pageRebuild/preparePageRebuild.js";


function png(width, height) {
    const buffer = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
}


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-page-plan-"));
try {
    await Promise.all([
        writeFile(path.join(directory, "1_avatar.png"), png(500, 500)),
        writeFile(path.join(directory, "2_cover.png"), png(1200, 450)),
        writeFile(path.join(directory, "3.png"), png(900, 900)),
        writeFile(path.join(directory, "notes.txt"), "ignore"),
    ]);
    const plan = await preparePageRebuild({ directory, imagesDirectory: directory });
    assert.equal(plan.avatar.filename, "1_avatar.png");
    assert.equal(plan.cover.filename, "2_cover.png");
    assert.deepEqual(plan.posts.map((item) => item.filename), ["3.png"]);
    assert.match(plan.fingerprint, /^[a-f0-9]{64}$/);

    const fallbackDirectory = await mkdtemp(path.join(os.tmpdir(), "adsbot-page-fallback-"));
    try {
        await Promise.all([
            writeFile(path.join(fallbackDirectory, "1_bad.png"), png(1200, 300)),
            writeFile(path.join(fallbackDirectory, "avatar.png"), png(600, 600)),
            writeFile(path.join(fallbackDirectory, "cover.png"), png(1200, 450)),
            writeFile(path.join(fallbackDirectory, "post.png"), png(700, 700)),
        ]);
        const fallback = await preparePageRebuild({
            imagesDirectory: fallbackDirectory,
            random: () => 0,
        });
        assert.equal(fallback.avatar.filename, "avatar.png");
        assert.equal(fallback.cover.filename, "cover.png");
        assert(fallback.posts.some((item) => item.filename === "1_bad.png"));
    } finally {
        await rm(fallbackDirectory, { recursive: true, force: true });
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}

const oldDates = createBackdatedSchedule({
    count: 4,
    pageCreatedAt: "2024-01-15T00:00:00.000Z",
    now: new Date("2026-08-21T15:00:00.000Z"),
    random: () => 0,
});
assert.equal(oldDates.length, 4);
assert.equal(new Set(oldDates).size, 4);
assert(oldDates.every((date, index) => index === 0 || date > oldDates[index - 1]));
assert(oldDates[0] >= "2024-02-15T00:00:00.000Z");
assert(oldDates.at(-1) <= "2026-07-21T00:00:00.000Z");

const youngDates = createBackdatedSchedule({
    count: 3,
    pageCreatedAt: "2026-07-01T00:00:00.000Z",
    now: new Date("2026-08-21T15:00:00.000Z"),
    random: (() => {
        const values = [0, 0.5, 0.99];
        return () => values.shift() ?? 0;
    })(),
});
assert.equal(new Set(youngDates).size, 3);
assert(youngDates[0] >= "2026-07-01T00:00:00.000Z");
assert(youngDates.at(-1) <= "2026-08-21T00:00:00.000Z");

await assert.rejects(async () => createBackdatedSchedule({
    count: 3,
    pageCreatedAt: "2026-08-20T00:00:00.000Z",
    now: new Date("2026-08-21T15:00:00.000Z"),
}), { code: "PAGE_REBUILD_DATE_RANGE_TOO_SMALL" });

console.log("Перевірка планування пересетаплення пройшла успішно");
