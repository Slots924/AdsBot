import assert from "node:assert/strict";
import { appendFile, mkdtemp, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AppLogger from "../services/logging/AppLogger.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-logger-"));
try {
    const logger = new AppLogger({
        logsDirectory: directory,
        level: "info",
        segmentBytes: 300,
        maximumBytes: 5000,
    });
    await logger.initialize();
    const live = [];
    logger.subscribe((entry) => live.push(entry));
    logger.debug("hidden", "Цього запису не має бути");
    logger.info("security.test", "token=EAAverySecret", {
        accessToken: "EAAotherSecret",
        nested: { cookie: "c_user=1", safe: "ok" },
    });
    logger.error("error.test", "Помилка", { error: Object.assign(new Error("boom"), { code: "TEST" }) });
    await Promise.all([
        logger.runWithContext({ taskId: "task-a" }, async () => {
            await Promise.resolve();
            logger.child("worker").info("task.step", "A");
        }),
        logger.runWithContext({ taskId: "task-b" }, async () => {
            await Promise.resolve();
            logger.child("worker").warn("task.step", "B");
        }),
    ]);
    for (let index = 0; index < 8; index += 1) {
        logger.info("rotation.test", `Запис ${index} ${"x".repeat(80)}`);
    }
    await logger.flush();
    assert.equal(live.some((entry) => entry.event === "hidden"), false);
    assert.equal(JSON.stringify(live).includes("EAAverySecret"), false);
    assert.equal(JSON.stringify(live).includes("c_user=1"), false);
    assert.equal(JSON.stringify(live).includes("stack"), false);
    assert.equal(live.find((entry) => entry.message === "A").context.taskId, "task-a");
    assert.equal(live.find((entry) => entry.message === "B").context.taskId, "task-b");
    assert((await readdir(directory)).length > 1);

    const firstFile = (await readdir(directory))[0];
    await appendFile(path.join(directory, firstFile), "{broken json\n", "utf8");
    const listed = await logger.list({ query: "Запис", limit: 3 });
    assert.equal(listed.items.length, 3);
    assert(listed.nextCursor);
    assert.equal((await logger.list({ cursor: listed.nextCursor, query: "Запис", limit: 20 })).items.length, 5);
    const today = new Date().toISOString().slice(0, 10);
    assert((await logger.list({ dateFrom: today, dateTo: today })).items.length > 0);

    const expired = path.join(directory, "adsbot-2020-01-01.jsonl");
    await writeFile(expired, "{}\n", "utf8");
    await utimes(expired, new Date("2020-01-01"), new Date("2020-01-01"));
    await logger.cleanup(new Date("2026-08-20").getTime());
    await assert.rejects(stat(expired), { code: "ENOENT" });

    logger.setLevel("debug");
    logger.debug("visible", "Debug працює");
    await logger.flush();
    assert.equal(live.some((entry) => entry.event === "visible"), true);

    const blockedPath = path.join(directory, "not-a-directory");
    await writeFile(blockedPath, "x", "utf8");
    const nonBlocking = new AppLogger({ logsDirectory: blockedPath });
    await nonBlocking.initialize();
    nonBlocking.error("sink.failed", "Це не повинно кинути exception");
    await nonBlocking.flush();
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Перевірка AppLogger пройшла успішно");
