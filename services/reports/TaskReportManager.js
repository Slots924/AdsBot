import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { sanitize } from "../logging/AppLogger.js";
import { historyReferences, readHttpHistory, buildHttpHistoryMarkdown } from "./httpHistoryReport.js";
import { cleanHistory } from "./httpHistoryPolicy.js";


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
        ...(report.resultSummary?.summary && Array.isArray(report.resultSummary.rows)
            ? dialogueMarkdown(report.resultSummary)
            : ["```json", JSON.stringify(report.resultSummary, null, 2), "```"]),
    ];
    if (report.errors?.length) {
        lines.push("", "## Помилки", "", "```json", JSON.stringify(report.errors, null, 2), "```");
    }
    return `${lines.join("\n")}\n${buildHttpHistoryMarkdown(report.httpHistoryEvents ?? [])}`;
}

function dialogueMarkdown(result) {
    const cell = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
    const labels = { success: 'Опубліковано', failed: 'Помилка', unknown: 'Результат невідомий', skipped: 'Пропущено', pending: 'Не виконано' };
    return [result.summaryText, '', '| Рядок / батько | Дія | Профіль | Результат | Причина |', '| --- | --- | --- | --- | --- |',
        ...result.rows.map(row => `| ${cell(row.id)} / ${cell(row.parent_id)} | ${row.type === 'reply' ? 'Реплай' : 'Коментар'} | ${cell(row.profileNo)} | ${row.status === 'success' && row.commentTarget?.commentUrl ? `[Опубліковано](${row.commentTarget.commentUrl})` : cell(labels[row.status])} | ${cell(row.counterWarning || row.storageWarning || row.message)} |`)];
}


export default class TaskReportManager {
    #operation = Promise.resolve();


    constructor({ reportsDirectory = "./data/reports/tasks", httpHistoryDirectory = path.resolve(reportsDirectory, "../http") } = {}) {
        this.reportsDirectory = path.resolve(reportsDirectory);
        this.httpHistoryDirectory = path.resolve(httpHistoryDirectory);
    }


    createFromTask(task, details = {}, { reportId = null } = {}) {
        return this.#enqueue(async () => {
            const previous = reportId ? await this.get(reportId) : null;
            const report = sanitize({
                version: 1,
                id: reportId ?? randomUUID(),
                taskId: task.id,
                type: task.type,
                title: task.name,
                status: task.status,
                createdAt: previous?.createdAt ?? new Date().toISOString(),
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
            // Посилання обробляються окремо: загальний sanitizer сприймає повтор того самого об'єкта як цикл.
            report.httpHistories = historyReferences({ task, details }).map(reference => sanitize({ ...reference }));
            // Повний результат діалогу зберігається без обрізання рядків і вкладених спроб.
            if (task.result?.summary && Array.isArray(task.result.rows)) report.resultSummary = cleanHistory(details.resultSummary ?? task.result);
            await mkdir(this.reportsDirectory, { recursive: true });
            const target = this.#file(report.id);
            const temporary = `${target}.tmp`;
            await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
            await rename(temporary, target);
            return structuredClone(report);
        });
    }


    recoverInterrupted() {
        return this.#enqueue(async () => {
            const reports = await this.#readAll();
            for (const report of reports.filter(item => item.status === "running" && !item.taskId)) {
                report.status = "interrupted";
                report.finishedAt = new Date().toISOString();
                report.errors = [...(report.errors ?? []), { code: "HTTP_ACTION_INTERRUPTED_BY_RESTART",
                    message: "Застосунок завершився до збереження підсумку дії. Перевірте HTTP-історію перед повтором" }];
                const target = this.#file(report.id);
                await writeFile(`${target}.tmp`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
                await rename(`${target}.tmp`, target);
            }
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


    async get(id, { includeHttpHistory = false } = {}) {
        try {
            const report = JSON.parse(await readFile(this.#file(id), "utf8"));
            if (includeHttpHistory) {
                report.httpHistoryEvents = (await Promise.all((report.httpHistories ?? []).map(reference => readHttpHistory(reference, this.httpHistoryDirectory)))).flat();
            }
            return report;
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
        const report = await this.get(id, { includeHttpHistory: true });
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
