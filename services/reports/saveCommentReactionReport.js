import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


function escapeCell(value) {
    return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}


function table(headers, rows) {
    return [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    ].join("\n");
}


function duration(startedAt, finishedAt) {
    const milliseconds = Math.max(0, new Date(finishedAt) - new Date(startedAt));
    const seconds = Math.round(milliseconds / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}


export function buildCommentReactionMarkdown(report) {
    const profiles = Array.isArray(report.profiles) ? report.profiles : [];
    const total = (field) => profiles.reduce((sum, item) => sum + Number(item[field] ?? 0), 0);
    const status = (item) => ({
        success: "Успіх",
        completed_with_warnings: "Успіх з попередженням",
        skipped: "Пропущено",
        failed: "Помилка",
    }[item.outcome] ?? item.outcome);
    return [
        "# Звіт реакцій під коментарями",
        "",
        table(["Параметр", "Значення"], [
            ["Пост", report.postUrl],
            ["Профілів обрано", profiles.length],
            ["Реакції", Object.entries(report.reactions).filter(([, count]) => count > 0).map(([name, count]) => `${name}: ${count}`).join(", ") || "—"],
            ["Replies", report.includeReplies ? "Так" : "Ні"],
            ["Воркерів", report.concurrency],
            ["Не виконано плану", Object.entries(report.unfulfilledReactions ?? {}).filter(([, count]) => count > 0).map(([name, count]) => `${name}: ${count}`).join(", ") || "Немає"],
            ["Поставлено", total("applied")],
            ["Вже встановлено", total("alreadyReacted")],
            ["Невдало", total("failed")],
            ["Тривалість", duration(report.startedAt, report.finishedAt)],
        ]),
        "",
        "## Профілі",
        "",
        table(["№", "Реакція", "Статус", "Вдало", "Невдало", "Вже було", "Час", "Примітка"], profiles.map((item) => [
            item.profileNo,
            item.reaction,
            status(item),
            item.applied,
            item.failed,
            item.alreadyReacted,
            duration(item.startedAt, item.finishedAt),
            item.errors?.[0]
                ? `${item.errors[0].reason}${item.errors[0].commentId ? ` · ${item.errors[0].commentId}` : ""}`
                : item.error || "—",
        ])),
        "",
    ].join("\n");
}


export default async function saveCommentReactionReport(report, reportsDirectory) {
    await mkdir(reportsDirectory, { recursive: true });
    const stamp = report.finishedAt.replace(/[:.]/g, "-");
    const reportPath = path.join(reportsDirectory, `comment-reaction-report_${stamp}.md`);
    await writeFile(reportPath, buildCommentReactionMarkdown(report), "utf8");
    return reportPath;
}
