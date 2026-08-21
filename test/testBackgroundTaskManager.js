import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import BackgroundTaskJournal
    from "../services/tasks/BackgroundTaskJournal.js";
import BackgroundTaskManager
    from "../services/tasks/BackgroundTaskManager.js";
import TaskReportManager from "../services/reports/TaskReportManager.js";


const waitUntil = async (predicate, timeout = 2000) => {
    const started = Date.now();
    while (!await predicate()) {
        if (Date.now() - started > timeout) throw new Error("Перевищено час очікування тесту");
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
};


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-tasks-"));
const tasksFile = path.join(directory, "tasks.json");

try {
    const journal = new BackgroundTaskJournal({ tasksFile });
    const reportManager = new TaskReportManager({
        reportsDirectory: path.join(directory, "reports"),
    });
    const manager = new BackgroundTaskManager({
        journal,
        commentConcurrency: 2,
        reportManager,
    });
    await manager.initialize();

    const started = [];
    const releases = new Map();
    const runner = (name) => async () => {
        started.push(name);
        await new Promise((resolve) => releases.set(name, resolve));
        return { result: { name } };
    };
    const enqueueComment = (name, groupId) => manager.enqueue({
        type: "comments",
        name,
        resources: [{ key: `adspower-group:${groupId}`, label: groupId }],
        runner: runner(name),
    });

    await enqueueComment("A", "HU");
    await enqueueComment("B", "CZ");
    await enqueueComment("C", "HU");
    await waitUntil(() => started.length === 1);
    assert.deepEqual(started, ["A"]);

    releases.get("A")();
    await waitUntil(() => started.includes("B"));
    releases.get("B")();
    await waitUntil(() => started.includes("C"));
    releases.get("C")();
    await waitUntil(async () => !(await manager.hasUnfinished()));
    const finishedA = (await manager.list()).find((task) => task.name === "A");
    assert(finishedA.metadata.reportId);
    await manager.dismiss(finishedA.id);
    assert(await reportManager.get(finishedA.metadata.reportId));

    const campaignStarted = [];
    let releaseCampaign;
    await manager.enqueue({
        type: "campaign",
        name: "Campaign 1",
        uniqueKey: "campaign-job:one",
        resources: [{ key: "facebook-campaign-write" }],
        runner: async () => {
            campaignStarted.push("one");
            await new Promise((resolve) => { releaseCampaign = resolve; });
        },
    });
    await assert.rejects(
        manager.enqueue({
            type: "campaign",
            name: "Campaign duplicate",
            uniqueKey: "campaign-job:one",
            resources: [{ key: "facebook-campaign-write" }],
            runner: async () => {},
        }),
        { code: "BACKGROUND_TASK_ALREADY_QUEUED" }
    );
    await manager.enqueue({
        type: "campaign",
        name: "Campaign 2",
        resources: [{ key: "facebook-campaign-write" }],
        runner: async () => { campaignStarted.push("two"); },
    });
    await waitUntil(() => campaignStarted.length === 1);
    assert.deepEqual(campaignStarted, ["one"]);
    releaseCampaign();
    await waitUntil(() => campaignStarted.length === 2);
    await waitUntil(async () => !(await manager.hasUnfinished()));

    const publicationStarted = [];
    let releasePublication;
    await manager.enqueue({
        type: "publication",
        name: "Publication 1",
        resources: [{ key: "facebook-page-publish" }],
        runner: async () => {
            publicationStarted.push("one");
            await new Promise((resolve) => { releasePublication = resolve; });
        },
    });
    await manager.enqueue({
        type: "publication",
        name: "Publication 2",
        resources: [{ key: "facebook-page-publish" }],
        runner: async () => { publicationStarted.push("two"); },
    });
    await waitUntil(() => publicationStarted.length === 1);
    assert.deepEqual(publicationStarted, ["one"]);
    releasePublication();
    await waitUntil(() => publicationStarted.length === 2);
    await waitUntil(async () => !(await manager.hasUnfinished()));

    const orphan = await journal.create({ type: "comments", name: "Orphan" });
    const restoredJournal = new BackgroundTaskJournal({ tasksFile });
    await restoredJournal.initialize();
    assert.equal((await restoredJournal.get(orphan.id)).status, "interrupted");

    console.log("Mock-перевірка BackgroundTaskManager пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
