import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


function cleanDraft(input = {}) {
    return {
        accountKey: String(input.accountKey ?? ""), pageId: String(input.pageId ?? ""),
        geo: String(input.geo ?? "").trim().toUpperCase(), creativeName: String(input.creativeName ?? "").trim().replace(/^Creo_/i, ""),
        siteUrl: String(input.siteUrl ?? "").trim(), imagePath: String(input.imagePath ?? ""),
        imagePaths: [...new Set((input.imagePaths ?? []).map((item) => String(item ?? "").trim()).filter(Boolean))],
        deleteOldPosts: input.deleteOldPosts !== false, groupIds: [...new Set((input.groupIds ?? []).map(String))],
        campaignName: String(input.campaignName ?? "").trim(), campaignNameManual: input.campaignNameManual === true,
        templateId: Number(input.templateId), adAccountId: String(input.adAccountId ?? ""),
        pixelId: String(input.pixelId ?? "").trim(), utm: String(input.utm ?? ""),
        adSetCount: Number(input.adSetCount), dailyBudget: Number(input.dailyBudget),
        startTime: String(input.startTime ?? ""),
        createPaused: input.createPaused !== false,
        createAdSetsPaused: input.createAdSetsPaused !== false,
        createAdsPaused: input.createAdsPaused !== false,
        browserMode: input.browserMode === "headless" ? "headless" : "visible",
        disableImages: input.disableImages === true,
        commentWorkerConcurrency: Math.min(5, Math.max(1, Number(input.commentWorkerConcurrency) || 5)),
        commentWorkerProxyIds: Object.fromEntries(
            Object.entries(input.commentWorkerProxyIds ?? {})
                .filter(([workerId, proxyId]) => {
                    const worker = Number(workerId);
                    return Number.isInteger(worker)
                        && worker >= 1
                        && worker <= 5
                        && String(proxyId ?? "").trim();
                })
                .map(([workerId, proxyId]) => [String(Number(workerId)), String(proxyId).trim()])
        ),
    };
}


export default class CreativeLaunchJournal {
    #operation = Promise.resolve();
    constructor({ jobsFile = "./data/creative-launch-jobs.json" } = {}) { this.jobsFile = jobsFile; }

    create(draft, { parentJobId = null, mode = "full" } = {}) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const now = new Date().toISOString();
            const job = {
                id: randomUUID(), parentJobId, mode, draft: cleanDraft(draft), status: "queued",
                post: null, campaignJobId: null, cleanup: { deleted: [], failed: [] },
                subtasks: [
                    { id: "publication", title: "Підготовка і публікація", status: "pending", progress: {} },
                    { id: "campaign", title: "Створення кампанії", status: "pending", progress: {} },
                    { id: "comments", title: "Коментування", status: "pending", progress: {} },
                ], commentsResume: null, errors: [], createdAt: now, updatedAt: now,
            };
            store.jobs.unshift(job); store.jobs = store.jobs.slice(0, 100);
            await this.#write(store); return structuredClone(job);
        });
    }

    async get(id) { return structuredClone((await this.#read()).jobs.find((job) => job.id === String(id)) ?? null); }
    update(id, patch) {
        return this.#enqueue(async () => {
            const store = await this.#read(); const index = store.jobs.findIndex((job) => job.id === String(id));
            if (index < 0) throw Object.assign(new Error("Workflow запуску не знайдено"), { code: "CREATIVE_LAUNCH_NOT_FOUND" });
            store.jobs[index] = { ...store.jobs[index], ...structuredClone(patch), updatedAt: new Date().toISOString() };
            await this.#write(store); return structuredClone(store.jobs[index]);
        });
    }
    updateSubtask(id, subtaskId, patch) {
        return this.#enqueue(async () => {
            const store = await this.#read(); const index = store.jobs.findIndex((job) => job.id === String(id));
            if (index < 0) throw Object.assign(new Error("Workflow запуску не знайдено"), { code: "CREATIVE_LAUNCH_NOT_FOUND" });
            store.jobs[index].subtasks = store.jobs[index].subtasks.map((item) => item.id === subtaskId ? { ...item, ...structuredClone(patch) } : item);
            store.jobs[index].updatedAt = new Date().toISOString();
            await this.#write(store); return structuredClone(store.jobs[index]);
        });
    }
    #enqueue(operation) { const result = this.#operation.then(operation, operation); this.#operation = result.catch(() => {}); return result; }
    async #read() {
        try { const parsed = JSON.parse(await readFile(this.jobsFile, "utf8")); return { version: 1, jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [] }; }
        catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return { version: 1, jobs: [] }; throw error; }
    }
    async #write(store) { await mkdir(path.dirname(this.jobsFile), { recursive: true }); const temporary = `${this.jobsFile}.tmp`; await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8"); await rename(temporary, this.jobsFile); }
}

export { cleanDraft as normalizeCreativeLaunchDraft };
