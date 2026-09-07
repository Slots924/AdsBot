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


function formatDuration(durationMs) {
    const milliseconds = Number(durationMs);
    if (!Number.isFinite(milliseconds)) return "—";
    const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours) return `${hours} год ${minutes} хв ${seconds} с`;
    if (minutes) return `${minutes} хв ${seconds} с`;
    return `${seconds} с`;
}


function stepProblem(step) {
    if (!step || step.ok || step.skipped) return null;
    return step.error || step.status || "невідома причина";
}


function profileProblem(item) {
    if (item.error) return item.error;
    if (item.skipReason) return item.skipReason;
    for (const step of Object.values(item.steps ?? {})) {
        const problem = stepProblem(step);
        if (problem) return problem;
    }
    return null;
}


function photoValue(step) {
    if (!step) return "Не виконували";
    if (step.skipped) return `Пропущено${step.reason ? ` — ${step.reason}` : ""}`;
    if (step.ok) {
        return step.attempts > 1
            ? `Успішно з ${step.attempts}-ї спроби`
            : "Успішно";
    }
    return `Не вдалося — ${stepProblem(step)}`;
}


function ordinaryStepValue(step) {
    if (!step) return "Не виконували";
    if (step.skipped) return `Пропущено${step.reason ? ` — ${step.reason}` : ""}`;
    if (step.ok) return step.detail || "Успішно";
    return `Не вдалося — ${stepProblem(step)}`;
}


function facebookNameValue(item, fullName) {
    const step = item.steps?.name;
    if (item.outcome === "skipped") {
        return `Не виконували${item.skipReason ? ` — ${item.skipReason}` : ""}`;
    }
    if (step?.ok && fullName) return `${fullName} · ${genderLabel(item.persona?.gender)}`;
    if (step?.skipped) return `Пропущено${step.reason ? ` — ${step.reason}` : ""}`;
    return `Не вдалося змінити — ${stepProblem(step) || item.error || "невідома причина"}`;
}

function postsValue(step) {
    if (!step) return "Не виконували";
    if (step.skipped) return `Пропущено${step.reason ? ` — ${step.reason}` : ""}`;
    const published = String(step.detail ?? "").match(/(?:^|\s)(\d+)\s+фото/u);
    if (step.ok) return published ? `Опубліковано: ${published[1]}` : "Успішно";
    const partial = step.detail ? `; ${step.detail}` : "";
    return `Не вдалося — ${stepProblem(step)}${partial}`;
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

    lines.push(createTable(["Дані", "Результат"], [
        ["Час виконання", formatDuration(item.durationMs)],
        ["Ім’я Facebook", facebookNameValue(item, fullName)],
        ["Назва AdsPower", item.adsPowerName ? `\`${item.adsPowerName}\`` : ordinaryStepValue(steps.adsPowerRename)],
        ["Аватарка", photoValue(steps.avatar)],
        ["Обкладинка", photoValue(steps.cover)],
        ["Видалення постів", ordinaryStepValue(steps.deletePosts)],
        ["Нові пости", postsValue(steps.posts)],
        ["Дані про себе", ordinaryStepValue(steps.about)],
    ]));

    const problem = profileProblem(item);
    if (problem) lines.push("", `> Причина: ${escapeText(problem)}`);

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
    const outcomeOrder = { failed: 0, completed_with_error: 1, skipped: 2, success: 3 };
    const orderedProfiles = [...profiles].sort((left, right) => (
        (outcomeOrder[left.outcome] ?? 4) - (outcomeOrder[right.outcome] ?? 4)
        || String(left.profileNo).localeCompare(String(right.profileNo), "uk-UA", { numeric: true })
    ));
    const profileRows = orderedProfiles.map((item) => [
        item.profileNo,
        outcomeLabel(item.outcome),
        genderLabel(item.persona?.gender),
        [item.persona?.firstName, item.persona?.lastName]
            .filter(Boolean)
            .join(" "),
        profileProblem(item),
    ]);
    const sections = [
        "# Звіт оформлення акаунтів під коментарі",
        "",
        `- Початок: ${formatDateTime(report.startedAt)}`,
        `- Завершення: ${formatDateTime(report.finishedAt)}`,
        `- Загальний час: ${formatDuration(new Date(report.finishedAt) - new Date(report.startedAt))}`,
        `- Гео: ${escapeCell(report.geo)}`,
        `- Профілів у списку: ${escapeCell(report.profileNos?.length)}`,
        `- Персонажів у JSON: ${escapeCell(report.personaCount)}`,
        `- Папка фото: ${escapeCell(report.photosDirectory)}`,
        `- Воркерів: ${escapeCell(report.concurrency)}`,
        `- Режим браузера: ${report.browserMode === "headless" ? "Headless" : "Звичайний"}`,
        `- Критична помилка: ${escapeCell(report.fatalError)}`,
        `- Стан: ${report.interrupted ? "Перервано користувачем" : "Завершено"}`,
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

    if (orderedProfiles.length === 0) {
        sections.push("Немає профілів для звіту.", "");
    } else {
        const groups = [
            ["Не вдалося", "failed"],
            ["Завершено з помилкою", "completed_with_error"],
            ["Пропущено", "skipped"],
            ["Успішно", "success"],
        ];
        groups.forEach(([title, outcome]) => {
            const items = orderedProfiles.filter((item) => item.outcome === outcome);
            if (!items.length) return;
            sections.push(`## ${title}`, "");
            items.forEach((item, index) => {
                if (index > 0) sections.push("");
                sections.push(buildProfileSection(item), "");
            });
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
