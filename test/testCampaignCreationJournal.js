import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import CampaignCreationJournal
    from "../services/campaigns/CampaignCreationJournal.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-campaign-jobs-"));
try {
    const jobsFile = path.join(directory, "jobs.json");
    const journal = new CampaignCreationJournal({ jobsFile });
    const job = await journal.create({
        accountKey: "client",
        adAccountId: "act_1",
        templateId: 2,
        campaignName: "Test",
        pageId: "10",
        postId: "20",
        adSetCount: 2,
        dailyBudget: 5,
        startTime: "2026-08-20T10:00:00.000Z",
        createPaused: true,
        accessToken: "access-token-must-not-be-saved",
        cookie: "cookie-must-not-be-saved",
        utm: "must-not-be-copied-to-job",
    });
    assert.equal(job.total, 7);
    await journal.update(job.id, {
        stage: "campaign",
        objects: {
            ...job.objects,
            campaignId: "campaign-1",
        },
    });

    const restored = await new CampaignCreationJournal({ jobsFile }).get(job.id);
    assert.equal(restored.objects.campaignId, "campaign-1");
    assert.equal(restored.input.utm, "must-not-be-copied-to-job");
    const raw = await readFile(jobsFile, "utf8");
    assert(!raw.includes("access-token-must-not-be-saved"));
    assert(!raw.includes("cookie-must-not-be-saved"));
    assert(raw.includes("must-not-be-copied-to-job"));
    console.log("Перевірка журналу створення кампаній пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
