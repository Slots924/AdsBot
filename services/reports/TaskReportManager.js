import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sanitize } from "../logging/AppLogger.js";


function summarizeInput(input = {}) {
    const summary = { ...input };
    if ("imagePath" in summary) {
        summary.hasImage = Boolean(summary.imagePath);
        delete summary.imagePath;
    }
    return summary;
}


function markdown(report) {
    const lines = [
        `# ${report.title}`,
        "",
        `- Тип: ${report.type}`,
        `- Статус: ${report.status}`,
        `- Початок: ${report.startedAt ?? "—"}`,
        `- Завершення: ${report.finishedAt ?? "—"}`,
        `- Task ID: ${report.taskId ?? "—"}`,
        "",
        "## Вхідні дані",
        "",
        "```json",
        JSON.stringify(report.inputSummary, null, 2),
        "```",
        "",
        "## Результат",
        "",
        "```json",
        JSON.stringify(report.resultSummary, null, 2),
        "```",
    ];
    if (report.errors?.length) {
        lines.push("", "## Помилки", "", "```json", JSON.stringify(report.errors, null, 2), "```");
    }
    return `${lines.join("\n")}\n`;
}


export default class TaskReportManager {
    #operation = Promise.resolve();


    constructor({ reportsDirectory = "./data/reports/tasks" } = {}) {
        this.reportsDirectory = path.resolve(reportsDirectory);
    }


    createFromTask(task, details = {}) {
        return this.#enqueue(async () => {
            const report = sanitize({
                version: 1,
                id: randomUUID(),
                taskId: task.id,
                type: task.type,
                title: task.name,
                status: task.status,
                createdAt: new Date().toISOString(),
                startedAt: task.startedAt,
                finishedAt: task.finishedAt,
                durationMs: task.startedAt && task.finishedAt
                    ? Math.max(0, new Date(task.finishedAt) - new Date(task.startedAt))
                    : null,
                inputSummary: details.inputSummary ?? summarizeInput(task.input),
                resultSummary: details.resultSummary ?? task.result ?? null,
                counters: details.counters ?? {},
                warnings: details.warnings ?? [],
                errors: details.errors ?? (task.error ? [task.error] : []),
                artifacts: details.artifacts ?? [],
                metadata: task.metadata ?? {},
            });
            await mkdir(this.reportsDirectory, { recursive: true });
            const target = path.join(this.reportsDirectory, `${report.id}.json`);
            const temporary = `${target}.tmp`;
            await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
            await rename(temporary, target);
            return structuredClone(report);
        });
    }


    async list({ type, status, query = "", dateFrom, dateTo } = {}) {
        const reports = await this.#readAll();
        const needle = String(query).trim().toLowerCase();
        const normalizedDateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(dateTo ?? ""))
            ? `${dateTo}T23:59:59.999Z`
            : dateTo;
        return reports.filter((report) => (
            (!type || report.type === type)
            && (!status || report.status === status)
            && (!dateFrom || report.createdAt >= dateFrom)
            && (!normalizedDateTo || report.createdAt <= normalizedDateTo)
            && (!needle || `${report.title} ${report.taskId} ${report.type}`.toLowerCase().includes(needle))
        )).sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((report) => ({
            id: report.id,
            taskId: report.taskId,
            type: report.type,
            title: report.title,
            status: report.status,
            createdAt: report.createdAt,
            finishedAt: report.finishedAt,
            durationMs: report.durationMs,
        }));
    }


    async get(id) {
        try {
            return JSON.parse(await readFile(this.#file(id), "utf8"));
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw error;
        }
    }


    async delete(id) {
        await rm(this.#file(id), { force: true });
        return String(id);
    }


    async exportMarkdown(id, targetFile) {
        const report = await this.get(id);
        if (!report) throw Object.assign(new Error("Звіт не знайдено"), { code: "REPORT_NOT_FOUND" });
        await writeFile(targetFile, markdown(report), "utf8");
        return targetFile;
    }


    #file(id) {
        const normalized = String(id);
        if (!/^[0-9a-f-]{36}$/i.test(normalized)) throw Object.assign(new Error("Некоректний ID звіту"), { code: "REPORT_ID_INVALID" });
        return path.join(this.reportsDirectory, `${normalized}.json`);
    }


    async #readAll() {
        try {
            const files = (await readdir(this.reportsDirectory, { withFileTypes: true }))
                .filter((item) => item.isFile() && /^[0-9a-f-]{36}\.json$/i.test(item.name));
            const reports = await Promise.all(files.map(async (item) => {
                try { return JSON.parse(await readFile(path.join(this.reportsDirectory, item.name), "utf8")); } catch { return null; }
            }));
            return reports.filter(Boolean);
        } catch (error) {
            if (error.code === "ENOENT") return [];
            throw error;
        }
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }
}


export { markdown as buildReportMarkdown };
