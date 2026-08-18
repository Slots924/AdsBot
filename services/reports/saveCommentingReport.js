import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


function escapeCell(value) {
    return String(value ?? "—")
        .replace(/\r?\n/g, " ")
        .replace(/\|/g, "\\|")
        .trim() || "—";
}


function createTable(headers, rows) {
    const header = `| ${headers.join(" | ")} |`;
    const separator =
        `| ${headers.map(() => "---").join(" | ")} |`;

    if (rows.length === 0) {
        return `${header}\n${separator}\n| ${[
            "Немає даних",
            ...headers.slice(1).map(() => "—"),
        ].join(" | ")} |`;
    }

    const body = rows.map((row) =>
        `| ${row.map(escapeCell).join(" | ")} |`
    );

    return [header, separator, ...body].join("\n");
}


function formatDateTime(value) {
    return new Date(value).toLocaleString("uk-UA");
}


function createTimestamp(value) {
    const date = new Date(value);
    const pad = (number, length = 2) =>
        String(number).padStart(length, "0");

    return [
        date.getFullYear(),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
    ].join("-")
        + "_"
        + [
            pad(date.getHours()),
            pad(date.getMinutes()),
            pad(date.getSeconds()),
            pad(date.getMilliseconds(), 3),
        ].join("-");
}


function buildMarkdown(report) {
    const summaryRows = [
        ["Успішно опубліковано", report.published.length],
        ["Пропущено", report.skipped.length],
        ["Не вдалося опублікувати", report.failedComments.length],
        ["Невдалих профілів", report.failedProfiles.length],
        ["Виключених профілів", report.excludedProfiles.length],
        ["Попереджень очищення", report.cleanupWarnings.length],
    ];
    const profileKeyRows = Object.entries(report.profileKeyMap)
        .map(([key, profileNo]) => [key, profileNo]);
    const publishedRows = report.published.map((item) => [
        item.commentId,
        item.actionType,
        item.profileNo,
        item.gender,
        item.profileKey,
        item.text,
    ]);
    const skippedRows = report.skipped.map((item) => [
        item.commentId,
        item.reason,
        item.text,
    ]);
    const failedCommentRows = report.failedComments.map((item) => [
        item.commentId,
        item.actionType,
        item.reason,
        item.attempts,
        item.text,
    ]);
    const failedProfileRows = report.failedProfiles.map((item) => [
        item.profileNo,
        item.commentId,
        item.stage,
        item.error,
    ]);
    const excludedProfileRows = report.excludedProfiles.map((item) => [
        item.profileNo,
        item.reason,
    ]);
    const cleanupRows = report.cleanupWarnings.map((item) => [
        item.profileNo,
        item.commentId,
        item.error,
    ]);
    const sections = [
        "# Звіт кампанії коментування",
        "",
        `- Початок: ${formatDateTime(report.startedAt)}`,
        `- Завершення: ${formatDateTime(report.finishedAt)}`,
        `- ID груп AdsPower: ${escapeCell(report.groupIds?.join(", "))}`,
        `- Facebook-пост: ${escapeCell(report.postUrl)}`,
        `- Файл коментарів: ${escapeCell(report.commentsFilePath)}`,
        `- Критична помилка: ${escapeCell(report.fatalError)}`,
        "",
        "## Підсумок",
        "",
        createTable(["Результат", "Кількість"], summaryRows),
        "",
        "## Прив’язки profile_key",
        "",
        createTable(["Ключ", "Профіль"], profileKeyRows),
        "",
        "## Успішні коментарі",
        "",
        createTable(
            ["ID", "Тип", "Профіль", "Стать", "profile_key", "Текст"],
            publishedRows
        ),
        "",
        "## Пропущені коментарі",
        "",
        createTable(["ID", "Причина", "Текст"], skippedRows),
        "",
        "## Невдалі коментарі",
        "",
        createTable(
            ["ID", "Тип", "Причина", "Спроби", "Текст"],
            failedCommentRows
        ),
        "",
        "## Невдалі профілі",
        "",
        createTable(
            ["Профіль", "Коментар", "Етап", "Помилка"],
            failedProfileRows
        ),
        "",
        "## Виключені профілі",
        "",
        createTable(["Профіль", "Причина"], excludedProfileRows),
        "",
        "## Попередження очищення",
        "",
        createTable(
            ["Профіль", "Коментар", "Помилка"],
            cleanupRows
        ),
        "",
    ];

    return sections.join("\n");
}


export default async function saveCommentingReport(
    report,
    reportsDirectory = "./data/reports"
) {
    const absoluteDirectory = path.resolve(reportsDirectory);
    const fileName =
        `commenting-report_${createTimestamp(report.finishedAt)}.md`;
    const reportPath = path.join(absoluteDirectory, fileName);

    await mkdir(absoluteDirectory, { recursive: true });
    await writeFile(reportPath, buildMarkdown(report), "utf8");

    return reportPath;
}
