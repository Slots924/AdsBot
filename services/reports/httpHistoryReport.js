import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

export async function readHttpHistory(reference, directory = "./data/reports/http") {
    if (!reference || !/^[0-9a-f-]{36}$/i.test(reference.id ?? "")) return [];
    const expected = path.resolve(directory, `${reference.id}.jsonl`);
    if (path.resolve(reference.path ?? "") !== expected) throw Object.assign(new Error("Неприпустимий шлях HTTP-історії"), { code: "HTTP_HISTORY_PATH_INVALID" });
    const events = [];
    const lines = createInterface({ input: createReadStream(expected, { encoding: "utf8" }), crlfDelay: Infinity });
    try {
        for await (const line of lines) {
            if (!line.trim()) continue;
            try { events.push(JSON.parse(line)); }
            catch { events.push({ event: "history.incomplete", message: "Незавершений запис журналу після обриву програми" }); }
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        events.push({ event: "history.unavailable", message: "Файл HTTP-історії відсутній" });
    }
    return events;
}

export function historyReferences(value, result = new Map()) {
    if (!value || typeof value !== "object") return [...result.values()];
    if (value.httpHistory?.id) result.set(value.httpHistory.id, value.httpHistory);
    for (const [key, child] of Object.entries(value)) if (key !== "httpHistory") historyReferences(child, result);
    return [...result.values()];
}

function jsonBlock(value) {
    const json = JSON.stringify(value, null, 2);
    const length = [...json.matchAll(/`+/g)].reduce((maximum, match) => Math.max(maximum, match[0].length + 1), 3);
    const fence = "`".repeat(length);
    return `${fence}json\n${json}\n${fence}`;
}

export function buildHttpHistoryMarkdown(events) {
    if (!events.length) return "";
    const completed = new Set(events.filter(event => event.event === "request.finished").map(event => event.requestId));
    const sections = ["", "## Історія HTTP-запитів Facebook", "",
        "API-запити й відповіді записано повністю після приховування credentials. Службові сторінки сесії й токенів та статичні JS-ресурси замінено діагностичними підсумками. Байти файлів не записуються.", ""];
    let sequence = 0;
    for (const event of events) {
        if (event.event === "request.started" && completed.has(event.requestId)) continue;
        if (event.event === "request.finished" || event.event === "request.started") {
            sequence++;
            sections.push(`### ${sequence}. ${event.action ?? "Facebook"} · ${event.request?.method ?? ""} ${event.response?.status ?? "Відповідь не отримана"}`,
                "", jsonBlock(event), "");
        } else if (event.event !== "history.started") sections.push(jsonBlock(event), "");
    }
    return sections.join("\n");
}
