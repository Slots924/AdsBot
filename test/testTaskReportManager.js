import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import TaskReportManager from "../services/reports/TaskReportManager.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-reports-"));
try {
    const manager = new TaskReportManager({ reportsDirectory: directory });
    const report = await manager.createFromTask({
        id: "task-1",
        type: "publication",
        name: "Публікація · HU · 138",
        status: "completed",
        startedAt: "2026-08-20T10:00:00.000Z",
        finishedAt: "2026-08-20T10:00:02.000Z",
        input: { accessToken: "EAAsecret", creativeName: "138" },
        result: { postId: "10_20" },
        metadata: {},
    });
    assert.equal(report.durationMs, 2000);
    assert.equal(report.inputSummary.accessToken, "[REDACTED]");
    assert.equal((await manager.list({ type: "publication" })).length, 1);
    assert.equal((await manager.list({
        dateFrom: report.createdAt.slice(0, 10),
        dateTo: report.createdAt.slice(0, 10),
    })).length, 1);
    assert.equal((await manager.get(report.id)).resultSummary.postId, "10_20");

    const markdownFile = path.join(directory, "export.md");
    await manager.exportMarkdown(report.id, markdownFile);
    assert((await readFile(markdownFile, "utf8")).includes("Публікація · HU · 138"));
    await manager.delete(report.id);
    assert.equal(await manager.get(report.id), null);
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Перевірка TaskReportManager пройшла успішно");
