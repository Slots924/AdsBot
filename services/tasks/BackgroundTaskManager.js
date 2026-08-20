import { finishedStatuses } from "./BackgroundTaskJournal.js";
import { sanitize } from "../logging/AppLogger.js";


function safeError(error) {
    return sanitize({
        message: String(error?.message || "Невідома помилка"),
        code: error?.code ?? null,
        stage: error?.stage ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
    }, { forRenderer: true });
}


function publicTask(task) {
    if (!task) return null;
    const { input: _input, ...safe } = task;
    return safe;
}


export default class BackgroundTaskManager {
    #runtimes = new Map();
    #activeResources = new Set();
    #activeByType = new Map();
    #scheduleOperation = Promise.resolve();
    #enqueueOperation = Promise.resolve();
    #listeners = new Set();
    #shuttingDown = false;


    constructor({ journal, commentConcurrency = 2, logger = null, reportManager = null } = {}) {
        if (!journal) throw new Error("Не передано журнал фонових задач");
        this.journal = journal;
        this.logger = logger;
        this.reportManager = reportManager;
        this.typeLimits = new Map([
            ["comments", this.#normalizeCommentConcurrency(commentConcurrency)],
            ["campaign", 1],
            ["campaign-cleanup", 1],
        ]);
    }


    async initialize() {
        const tasks = await this.journal.initialize();
        for (const task of tasks.filter((item) => finishedStatuses.has(item.status) && !item.metadata?.reportId)) {
            await this.#attachReport(task);
        }
        await this.#emitList();
    }


    subscribe(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }


    async list() {
        return (await this.journal.list()).map(publicTask);
    }


    enqueue(options) {
        const result = this.#enqueueOperation.then(
            () => this.#enqueue(options),
            () => this.#enqueue(options)
        );
        this.#enqueueOperation = result.catch(() => {});
        return result;
    }


    async #enqueue({ type, name, resources, input, metadata, uniqueKey, runner }) {
        if (this.#shuttingDown) throw Object.assign(new Error("Програма завершує роботу й не приймає нові задачі"), { code: "TASK_MANAGER_SHUTTING_DOWN" });
        if (typeof runner !== "function") throw new Error("Для фонової задачі не передано runner");
        if (uniqueKey) {
            const duplicate = (await this.journal.list()).find((task) =>
                ["queued", "running"].includes(task.status)
                && task.metadata?.uniqueKey === uniqueKey
            );
            if (duplicate) throw Object.assign(
                new Error("Ця задача вже виконується або очікує в черзі"),
                { code: "BACKGROUND_TASK_ALREADY_QUEUED", taskId: duplicate.id }
            );
        }
        const task = await this.journal.create({
            type,
            name,
            resources,
            input,
            metadata: { ...metadata, ...(uniqueKey ? { uniqueKey } : {}) },
        });
        this.#runtimes.set(task.id, { runner, controller: new AbortController(), promise: null });
        await this.#emit(task);
        this.#schedule();
        return publicTask(task);
    }


    async cancel(id) {
        const task = await this.journal.get(id);
        if (!task) throw Object.assign(new Error("Фонову задачу не знайдено"), { code: "BACKGROUND_TASK_NOT_FOUND" });
        const runtime = this.#runtimes.get(task.id);
        if (task.status === "queued") {
            this.#runtimes.delete(task.id);
            const updated = await this.journal.update(task.id, {
                status: "cancelled",
                waitingReason: null,
                finishedAt: new Date().toISOString(),
                progress: { ...task.progress, stage: "cancelled", message: "Задачу скасовано до запуску" },
            });
            const reported = await this.#attachReport(updated);
            await this.#emit(reported);
            this.#schedule();
            return publicTask(reported);
        }
        if (task.status === "running" && runtime) {
            runtime.controller.abort();
            const updated = await this.journal.update(task.id, {
                progress: { ...task.progress, message: "Зупиняємо задачу після поточного безпечного етапу…" },
            });
            await this.#emit(updated);
            return publicTask(updated);
        }
        return publicTask(task);
    }


    async dismiss(id) {
        await this.journal.remove(id);
        await this.#emitList();
        return id;
    }


    async clearFinished() {
        const count = await this.journal.clearFinished();
        await this.#emitList();
        return count;
    }


    async setCommentConcurrency(value) {
        const normalized = this.#normalizeCommentConcurrency(value);
        this.typeLimits.set("comments", normalized);
        this.#schedule();
        return normalized;
    }


    async hasUnfinished() {
        return (await this.journal.list()).some((task) => ["queued", "running"].includes(task.status));
    }


    async shutdown() {
        this.#shuttingDown = true;
        const tasks = await this.journal.list();
        await Promise.all(tasks.filter((task) => task.status === "queued").map((task) => this.cancel(task.id)));
        for (const task of tasks.filter((item) => item.status === "running")) {
            this.#runtimes.get(task.id)?.controller.abort();
        }
        await Promise.allSettled([...this.#runtimes.values()].map((runtime) => runtime.promise).filter(Boolean));
    }


    #normalizeCommentConcurrency(value) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(5, Math.max(1, Math.round(number))) : 2;
    }


    #schedule() {
        this.#scheduleOperation = this.#scheduleOperation.then(() => this.#runScheduler(), () => this.#runScheduler());
    }


    async #runScheduler() {
        if (this.#shuttingDown) return;
        const queued = (await this.journal.list())
            .filter((task) => task.status === "queued" && this.#runtimes.has(task.id))
            .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));

        for (let index = 0; index < queued.length; index += 1) {
            const task = queued[index];
            const limit = this.typeLimits.get(task.type) ?? 1;
            const activeCount = this.#activeByType.get(task.type) ?? 0;
            const blockedResource = task.resources.find((resource) => this.#activeResources.has(resource.key));
            const earlierConflict = queued.slice(0, index).some((earlier) =>
                this.#runtimes.has(earlier.id)
                && earlier.resources.some((left) => task.resources.some((right) => left.key === right.key))
            );

            if (activeCount >= limit || blockedResource || earlierConflict) {
                const reason = blockedResource
                    ? `Очікує ресурс: ${blockedResource.label || blockedResource.key}`
                    : activeCount >= limit
                        ? "Очікує вільне місце в черзі"
                        : "Очікує попередню задачу з тією самою групою";
                if (task.waitingReason !== reason) {
                    const updated = await this.journal.update(task.id, { waitingReason: reason });
                    await this.#emit(updated);
                }
                continue;
            }

            this.#start(task);
        }
    }


    #start(task) {
        const runtime = this.#runtimes.get(task.id);
        if (!runtime || runtime.promise) return;
        task.resources.forEach((resource) => this.#activeResources.add(resource.key));
        this.#activeByType.set(task.type, (this.#activeByType.get(task.type) ?? 0) + 1);
        runtime.promise = this.#execute(task, runtime);
    }


    async #execute(task, runtime) {
        let current = await this.journal.update(task.id, {
            status: "running",
            waitingReason: null,
            startedAt: new Date().toISOString(),
            progress: { ...task.progress, stage: "starting", message: "Задачу запущено" },
        });
        await this.#emit(current);
        this.logger?.info("task.started", "Фонову задачу запущено", {
            taskId: task.id,
            taskType: task.type,
            name: task.name,
        });
        const progress = async (patch) => {
            current = await this.journal.update(task.id, {
                progress: { ...current.progress, ...structuredClone(patch) },
            });
            await this.#emit(current);
            return publicTask(current);
        };

        try {
            const invokeRunner = () => runtime.runner({
                signal: runtime.controller.signal,
                progress,
                task: publicTask(current),
            });
            const output = this.logger?.runWithContext
                ? await this.logger.runWithContext({
                    taskId: task.id,
                    taskType: task.type,
                    accountKey: task.metadata?.accountKey,
                    jobId: task.metadata?.campaignJobId,
                }, invokeRunner)
                : await invokeRunner();
            const status = runtime.controller.signal.aborted
                ? "interrupted"
                : output?.taskStatus === "completed_with_warnings"
                    ? "completed_with_warnings"
                    : "completed";
            current = await this.journal.update(task.id, {
                status,
                result: output?.result ?? output ?? null,
                error: null,
                finishedAt: new Date().toISOString(),
                progress: {
                    ...current.progress,
                    stage: status,
                    message: status === "interrupted" ? "Задачу перервано" : "Задачу завершено",
                },
            });
            current = await this.#attachReport(current, output?.reportDetails);
            this.logger?.info("task.finished", "Фонову задачу завершено", {
                taskId: task.id,
                status,
            });
        } catch (error) {
            const interrupted = runtime.controller.signal.aborted || error?.name === "AbortError";
            current = await this.journal.update(task.id, {
                status: interrupted ? "interrupted" : "failed",
                error: safeError(error),
                finishedAt: new Date().toISOString(),
                progress: { ...current.progress, stage: interrupted ? "interrupted" : "failed", message: interrupted ? "Задачу перервано" : safeError(error).message },
            });
            current = await this.#attachReport(current, error?.reportDetails);
            this.logger?.error("task.failed", interrupted ? "Фонову задачу перервано" : "Фонова задача завершилася помилкою", {
                taskId: task.id,
                status: current.status,
                error,
            });
        } finally {
            task.resources.forEach((resource) => this.#activeResources.delete(resource.key));
            this.#activeByType.set(task.type, Math.max(0, (this.#activeByType.get(task.type) ?? 1) - 1));
            this.#runtimes.delete(task.id);
            await this.#emit(current);
            this.#schedule();
        }
    }


    async #attachReport(task, details = {}) {
        if (!this.reportManager || task.metadata?.reportId) return task;
        try {
            const report = await this.reportManager.createFromTask(task, details);
            return this.journal.update(task.id, {
                metadata: { ...task.metadata, reportId: report.id },
            });
        } catch (error) {
            this.logger?.error("report.create.failed", "Не вдалося створити звіт задачі", {
                taskId: task.id,
                error,
            });
            return task;
        }
    }


    async #emit(task) {
        const safe = publicTask(task);
        await Promise.allSettled([...this.#listeners].map((listener) => listener({ type: "updated", task: safe })));
    }


    async #emitList() {
        const tasks = await this.list();
        await Promise.allSettled([...this.#listeners].map((listener) => listener({ type: "snapshot", tasks })));
    }
}


export { publicTask };
