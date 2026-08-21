import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


function emptyStore() {
    return { version: 1, jobs: [] };
}


export default class PageRebuildJournal {
    #operation = Promise.resolve();


    constructor({ jobsFile = "./data/page-rebuild-jobs.json" } = {}) {
        this.jobsFile = jobsFile;
    }


    async startOrResume({ accountKey, pageId, fingerprint, plan }) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const unfinished = store.jobs.find((job) => (
                job.accountKey === String(accountKey)
                && job.pageId === String(pageId)
                && !["completed", "completed_with_warnings"].includes(job.status)
            ));
            if (unfinished) {
                if (unfinished.fingerprint !== fingerprint) {
                    const error = new Error(
                        "Вміст папки змінився після незавершеного пересетаплення"
                    );
                    error.code = "PAGE_REBUILD_INPUT_CHANGED";
                    throw error;
                }
                unfinished.status = "running";
                unfinished.updatedAt = new Date().toISOString();
                await this.#write(store);
                return { job: structuredClone(unfinished), resumed: true };
            }

            const now = new Date().toISOString();
            const job = {
                id: randomUUID(),
                accountKey: String(accountKey),
                pageId: String(pageId),
                fingerprint,
                status: "running",
                stage: "prepared",
                plan: structuredClone(plan),
                snapshot: null,
                avatar: null,
                cover: null,
                cleanup: {
                    deletedPostIds: [],
                    deletedPhotoIds: [],
                    hiddenPostIds: [],
                },
                publications: [],
                warnings: [],
                createdAt: now,
                updatedAt: now,
            };
            store.jobs.unshift(job);
            await this.#write(store);
            return { job: structuredClone(job), resumed: false };
        });
    }


    async update(id, patch) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const index = store.jobs.findIndex((job) => job.id === String(id));
            if (index === -1) {
                const error = new Error("Журнал пересетаплення не знайдено");
                error.code = "PAGE_REBUILD_JOB_NOT_FOUND";
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
            if (error.code === "ENOENT" || error instanceof SyntaxError) {
                return emptyStore();
            }
            throw error;
        }
    }


    async #write(store) {
        await mkdir(path.dirname(this.jobsFile), { recursive: true });
        const temporary = `${this.jobsFile}.tmp`;
        await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        await rename(temporary, this.jobsFile);
    }
}
