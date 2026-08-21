import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";


function cleanInput(input = {}) {
    return {
        accountKey: String(input.accountKey ?? ""),
        adAccountId: String(input.adAccountId ?? ""),
        templateId: Number(input.templateId),
        pixelId: String(input.pixelId ?? ""),
        utm: String(input.utm ?? ""),
        campaignName: String(input.campaignName ?? ""),
        pageId: String(input.pageId ?? ""),
        postId: String(input.postId ?? ""),
        adSetCount: Number(input.adSetCount),
        dailyBudget: Number(input.dailyBudget),
        startTime: String(input.startTime ?? ""),
        createPaused: input.createPaused !== false,
    };
}


export default class CampaignCreationJournal {
    #operation = Promise.resolve();


    constructor({ jobsFile = "./data/campaign-creation-jobs.json" } = {}) {
        this.jobsFile = jobsFile;
    }


    async create(input) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const now = new Date().toISOString();
            const job = {
                id: randomUUID(),
                input: cleanInput(input),
                status: "queued",
                stage: "preflight",
                completed: 0,
                total: 3 + Number(input.adSetCount || 0) * 2,
                objects: {
                    campaignId: null,
                    creativeId: null,
                    adSets: [],
                    ads: [],
                },
                errors: [],
                createdAt: now,
                updatedAt: now,
            };
            store.jobs.unshift(job);
            store.jobs = store.jobs.slice(0, 100);
            await this.#write(store);
            return structuredClone(job);
        });
    }


    async get(id) {
        const store = await this.#read();
        const job = store.jobs.find((item) => item.id === String(id));
        return job ? structuredClone(job) : null;
    }


    async update(id, patch) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const index = store.jobs.findIndex((item) => item.id === String(id));
            if (index === -1) {
                const error = new Error("Спробу створення кампанії не знайдено");
                error.code = "CAMPAIGN_JOB_NOT_FOUND";
                throw error;
            }
            store.jobs[index] = {
                ...store.jobs[index],
                ...structuredClone(patch),
                updatedAt: new Date().toISOString(),
            };
            await this.#write(store);
            return structuredClone(store.jobs[index]);
        });
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }


    async #read() {
        try {
            const parsed = JSON.parse(await readFile(this.jobsFile, "utf8"));
            return {
                version: 1,
                jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [],
            };
        } catch (error) {
            if (error.code === "ENOENT") return { version: 1, jobs: [] };
            throw error;
        }
    }


    async #write(store) {
        await mkdir(path.dirname(this.jobsFile), { recursive: true });
        const temporaryFile = `${this.jobsFile}.tmp`;
        await writeFile(
            temporaryFile,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.jobsFile);
    }
}
