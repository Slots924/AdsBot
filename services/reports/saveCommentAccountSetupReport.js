import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


function escapeCell(value) {
    return String(value ?? "—")
        .replace(/\r?\n/g, " ")
        .replace(/\|/g, "\\|")
        .trim() || "—";
}


function escapeText(value) {
    return String(value ?? "—").trim() || "—";
}


function createTable(headers, rows) {
    const header = `| ${headers.join(" | ")} |`;
    const separator = `| ${headers.map(() => "---").join(" | ")} |`;

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
    const pad = (number, length = 2) => String(number).padStart(length, "0");

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


function outcomeLabel(outcome) {
    switch (outcome) {
        case "success":
            return "успішно";
        case "completed_with_error":
            return "завершено з помилкою";
        case "failed":
            return "не вдалося";
        case "skipped":
            return "пропущено";
        default:
            return outcome || "невідомо";
    }
}


function genderLabel(gender) {
    if (gender === "female") return "жінка";
    if (gender === "male") return "чоловік";
    return "—";
}


function stepLine(title, step) {
    if (!step) return `- ${title}: не виконували`;
    if (step.skipped) {
        return `- ${title}: пропущено${step.reason ? ` — ${step.reason}` : ""}`;
    }
    if (step.ok) {
        const detail = step.detail ? ` — ${step.detail}` : "";
        return `- ${title}: ок${detail}`;
    }
    const reason = step.error || step.status || "невідома причина";
    return `- ${title}: не вдалося — ${reason}`;
}


function buildProfileSection(item) {
    const persona = item.persona ?? {};
    const steps = item.steps ?? {};
    const fullName = [persona.firstName, persona.lastName]
        .filter(Boolean)
        .join(" ");
    const lines = [
        `### Профіль ${escapeText(item.profileNo)} — ${outcomeLabel(item.outcome)}`,
        "",
    ];

    if (item.skipReason) {
        lines.push(`- Причина: ${escapeText(item.skipReason)}`);
    }

    if (fullName) {
        lines.push(`- Персонаж: **${escapeText(fullName)}** (${genderLabel(persona.gender)})`);
    }

    if (item.adsPowerName) {
        lines.push(`- Назва в AdsPower: \`${escapeText(item.adsPowerName)}\``);
    }

    lines.push(stepLine("Ім’я Facebook", steps.name));
    lines.push(stepLine("Аватар", steps.avatar));
    lines.push(stepLine("Обкладинка", steps.cover));
    lines.push(stepLine("Видалення старих постів", steps.deletePosts));
    lines.push(stepLine("Нові пости", steps.posts));
    lines.push(stepLine("About", steps.about));
    lines.push(stepLine("Тег статі", steps.genderTag));
    lines.push(stepLine("Перейменування AdsPower", steps.adsPowerRename));
    lines.push(stepLine("Папка фото", steps.photoFolderRename));

    if (item.error && item.outcome !== "skipped") {
        lines.push(`- Загальна помилка: ${escapeText(item.error)}`);
    }

    return lines.join("\n");
}


export function buildCommentAccountSetupMarkdown(report) {
    const profiles = Array.isArray(report.profiles) ? report.profiles : [];
    const succeeded = profiles.filter((item) => item.outcome === "success");
    const completedWithError = profiles.filter(
        (item) => item.outcome === "completed_with_error"
    );
    const failed = profiles.filter((item) => item.outcome === "failed");
    const skipped = profiles.filter((item) => item.outcome === "skipped");
    const summaryRows = [
        ["Успішно", succeeded.length],
        ["Завершено з помилкою", completedWithError.length],
        ["Не вдалося", failed.length],
        ["Пропущено", skipped.length],
    ];
    const profileRows = profiles.map((item) => [
        item.profileNo,
        outcomeLabel(item.outcome),
        genderLabel(item.persona?.gender),
        [item.persona?.firstName, item.persona?.lastName]
            .filter(Boolean)
            .join(" "),
        item.error || item.skipReason,
    ]);
    const sections = [
        "# Звіт оформлення акаунтів під коментарі",
        "",
        `- Початок: ${formatDateTime(report.startedAt)}`,
        `- Завершення: ${formatDateTime(report.finishedAt)}`,
        `- Гео: ${escapeCell(report.geo)}`,
        `- Профілів у списку: ${escapeCell(report.profileNos?.length)}`,
        `- Персонажів у JSON: ${escapeCell(report.personaCount)}`,
        `- Папка фото: ${escapeCell(report.photosDirectory)}`,
        `- Воркерів: ${escapeCell(report.concurrency)}`,
        `- Режим браузера: ${report.browserMode === "headless" ? "Headless" : "Звичайний"}`,
        `- Критична помилка: ${escapeCell(report.fatalError)}`,
        "",
        "## Підсумок",
        "",
        createTable(["Результат", "Кількість"], summaryRows),
        "",
        "## Коротко по профілях",
        "",
        createTable(
            ["Профіль", "Результат", "Стать", "Ім’я", "Примітка"],
            profileRows
        ),
        "",
        "## Звіт по кожному профілю",
        "",
    ];

    if (profiles.length === 0) {
        sections.push("Немає профілів для звіту.", "");
    } else {
        profiles.forEach((item, index) => {
            if (index > 0) sections.push("");
            sections.push(buildProfileSection(item));
        });
        sections.push("");
    }

    return sections.join("\n");
}


export default async function saveCommentAccountSetupReport(
    report,
    reportsDirectory = "./data/reports"
) {
    const absoluteDirectory = path.resolve(reportsDirectory);
    const fileName =
        `comment-account-setup-report_${createTimestamp(report.finishedAt)}.md`;
    const reportPath = path.join(absoluteDirectory, fileName);

    await mkdir(absoluteDirectory, { recursive: true });
    await writeFile(
        reportPath,
        buildCommentAccountSetupMarkdown(report),
        "utf8"
    );

    return reportPath;
}
