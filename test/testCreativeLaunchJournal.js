import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import CreativeLaunchJournal from "../services/workflows/CreativeLaunchJournal.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-creative-launch-jobs-"));
try {
    const journal = new CreativeLaunchJournal({
        jobsFile: path.join(directory, "jobs.json"),
    });
    const job = await journal.create({
        accountKey: "client",
        pageId: "10",
        geo: "HU",
        creativeName: "17",
        campaignName: "HU | Creo_17",
        templateId: 2,
        adAccountId: "act_1",
        pixelId: "30",
        adSetCount: 1,
        dailyBudget: 5,
        startTime: "2026-09-02T10:00:00.000Z",
        createPaused: false,
        createAdSetsPaused: false,
        createAdsPaused: false,
    });

    assert.equal(job.draft.createPaused, false);
    assert.equal(job.draft.createAdSetsPaused, false);
    assert.equal(job.draft.createAdsPaused, false);
    console.log("Перевірка прапорців паузи запуску креативу пройшла");
} finally {
    await rm(directory, { recursive: true, force: true });
}
