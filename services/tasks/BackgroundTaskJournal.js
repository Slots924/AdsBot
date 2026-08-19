import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";


const finishedStatuses = new Set([
    "completed",
    "completed_with_warnings",
    "failed",
    "interrupted",
    "cancelled",
]);


export default class BackgroundTaskJournal {
    #operation = Promise.resolve();


    constructor({ tasksFile = "./data/background-tasks.json" } = {}) {
        this.tasksFile = tasksFile;
    }


    async initialize() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const now = new Date().toISOString();
            let changed = false;

            store.tasks = store.tasks.map((task) => {
                if (!["queued", "running"].includes(task.status)) return task;
                changed = true;
                return {
                    ...task,
                    status: "interrupted",
                    waitingReason: null,
                    error: task.error ?? {
                        code: "TASK_INTERRUPTED_BY_RESTART",
                        message: "Задачу перервано через завершення попереднього сеансу програми",
                    },
                    finishedAt: now,
                    updatedAt: now,
                };
            });

            if (changed) await this.#write(store);
            return structuredClone(store.tasks);
        });
    }


    async create({ type, name, resources = [], input = {}, metadata = {} }) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const now = new Date().toISOString();
            const task = {
                id: randomUUID(),
                type: String(type),
                name: String(name),
                status: "queued",
                resources: structuredClone(resources),
                input: structuredClone(input),
                metadata: structuredClone(metadata),
                progress: { completed: 0, total: 0, stage: "queued", message: "Задача очікує запуску" },
                result: null,
                error: null,
                waitingReason: null,
                createdAt: now,
                startedAt: null,
                finishedAt: null,
                updatedAt: now,
            };
            store.tasks.unshift(task);
            await this.#write(store);
            return structuredClone(task);
        });
    }


    async list() {
        return structuredClone((await this.#read()).tasks);
    }


    async get(id) {
        const task = (await this.#read()).tasks.find((item) => item.id === String(id));
        return task ? structuredClone(task) : null;
    }


    async update(id, patch) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const index = store.tasks.findIndex((task) => task.id === String(id));
            if (index === -1) throw Object.assign(new Error("Фонову задачу не знайдено"), { code: "BACKGROUND_TASK_NOT_FOUND" });
            store.tasks[index] = {
                ...store.tasks[index],
                ...structuredClone(patch),
                updatedAt: new Date().toISOString(),
            };
            await this.#write(store);
            return structuredClone(store.tasks[index]);
        });
    }


    async remove(id) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const task = store.tasks.find((item) => item.id === String(id));
            if (!task) throw Object.assign(new Error("Фонову задачу не знайдено"), { code: "BACKGROUND_TASK_NOT_FOUND" });
            if (!finishedStatuses.has(task.status)) throw Object.assign(new Error("Активну задачу не можна прибрати"), { code: "BACKGROUND_TASK_ACTIVE" });
            store.tasks = store.tasks.filter((item) => item.id !== task.id);
            await this.#write(store);
            return task.id;
        });
    }


    async clearFinished() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const removed = store.tasks.filter((task) => finishedStatuses.has(task.status)).length;
            store.tasks = store.tasks.filter((task) => !finishedStatuses.has(task.status));
            await this.#write(store);
            return removed;
        });
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }


    async #read() {
        try {
            const parsed = JSON.parse(await readFile(this.tasksFile, "utf8"));
            return { version: 1, tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [] };
        } catch (error) {
            if (error.code === "ENOENT" || error instanceof SyntaxError) return { version: 1, tasks: [] };
            throw error;
        }
    }


    async #write(store) {
        await mkdir(path.dirname(this.tasksFile), { recursive: true });
        const temporaryFile = `${this.tasksFile}.tmp`;
        await writeFile(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, "utf8");
        await rename(temporaryFile, this.tasksFile);
    }
}


export { finishedStatuses };
