import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


function cell(value) {
    return String(value ?? "—").replaceAll("|", "\\|").replaceAll("\n", " ");
}


function table(headers, rows) {
    return [
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    ].join("\n");
}


export function buildCommentAccountHealthMarkdown(report) {
    const profiles = report.profiles ?? [];
    const count = (outcome) => profiles.filter((item) => item.outcome === outcome).length;
    const labels = {
        working: "Робочий",
        banned: "Заблокований",
        not_logged_in: "Не залогінений",
        inactive: "Неактивний",
        error: "Помилка",
        failed: "Помилка",
    };
    const duration = Math.max(0, new Date(report.finishedAt) - new Date(report.startedAt));
    return [
        "# Перевірка акаунтів під коментарі",
        "",
        table(["Показник", "Значення"], [
            ["Перевірено акаунтів", profiles.length],
            ["Робочих", count("working")],
            ["Заблокованих", count("banned")],
            ["Не залогінених", count("not_logged_in")],
            ["Інших помилок", profiles.length - count("working") - count("banned") - count("not_logged_in")],
            ["Тривалість", `${Math.floor(duration / 60000)} хв ${Math.floor(duration / 1000) % 60} с`],
        ]),
        "",
        table(["Профіль", "Статус", "Login", "Active", "English", "Час", "Примітка"], profiles.map((item) => [
            item.profileNo,
            labels[item.outcome] ?? item.outcome,
            item.login,
            item.active,
            item.english,
            item.duration,
            item.error ?? item.cleanupError ?? "—",
        ])),
        "",
    ].join("\n");
}


export default async function saveCommentAccountHealthReport(report, reportsDirectory) {
    await mkdir(reportsDirectory, { recursive: true });
    const stamp = report.finishedAt.replace(/[:.]/g, "-");
    const reportPath = path.join(reportsDirectory, `comment-account-health-report_${stamp}.md`);
    await writeFile(reportPath, buildCommentAccountHealthMarkdown(report), "utf8");
    return reportPath;
}
