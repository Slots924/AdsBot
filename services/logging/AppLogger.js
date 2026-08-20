import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
    appendFile,
    mkdir,
    readdir,
    readFile,
    rm,
    stat,
} from "node:fs/promises";
import path from "node:path";


const levels = { debug: 10, info: 20, warn: 30, error: 40 };
const secretKey = /(token|cookie|authorization|password|secret|api.?key|proxy|utm)/i;
const logFilePattern = /^adsbot-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;


function truncate(value, maximum = 8000) {
    const text = String(value ?? "");
    return text.length > maximum ? `${text.slice(0, maximum)}…[TRUNCATED]` : text;
}


function redactString(value) {
    return truncate(value)
        .replace(/EAA[A-Za-z0-9_-]+/g, "[REDACTED]")
        .replace(/((?:access_)?token|cookie|authorization|password|secret|api[_-]?key|utm)=([^&\s]+)/gi, "$1=[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}


function sanitize(value, { forRenderer = false, depth = 0, seen = new WeakSet() } = {}) {
    if (depth > 6) return "[MAX_DEPTH]";
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return redactString(value);
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactString(value.message),
            code: value.code ?? null,
            stage: value.stage ?? null,
            ...(forRenderer ? {} : { stack: redactString(value.stack ?? "") }),
        };
    }
    if (typeof value !== "object") return redactString(value);
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Array.isArray(value)) {
        return value.slice(0, 100).map((item) => sanitize(item, {
            forRenderer,
            depth: depth + 1,
            seen,
        }));
    }
    return Object.fromEntries(Object.entries(value).slice(0, 100)
        .filter(([key]) => !(forRenderer && key.toLowerCase() === "stack"))
        .map(([key, item]) => [
        key,
        secretKey.test(key)
            ? "[REDACTED]"
            : sanitize(item, { forRenderer, depth: depth + 1, seen }),
    ]));
}


function safeRendererEvent(event) {
    return sanitize(event, { forRenderer: true });
}


function logFileOrder(left, right) {
    const leftMatch = left.match(logFilePattern);
    const rightMatch = right.match(logFilePattern);
    const dateDifference = rightMatch[1].localeCompare(leftMatch[1]);
    if (dateDifference) return dateDifference;
    return Number(rightMatch[2] ?? 0) - Number(leftMatch[2] ?? 0);
}


function encodeCursor(value) {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
}


function decodeCursor(value) {
    try {
        const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
        return {
            fileIndex: Math.max(0, Number(parsed.fileIndex) || 0),
            lineIndex: Number.isInteger(parsed.lineIndex) ? parsed.lineIndex : null,
        };
    } catch {
        return { fileIndex: 0, lineIndex: null };
    }
}


export default class AppLogger {
    #storage = new AsyncLocalStorage();
    #writeQueue = Promise.resolve();
    #listeners = new Set();
    #fileWarningSent = false;


    constructor({
        logsDirectory = "./data/logs",
        level = "info",
        retentionDays = 30,
        maximumBytes = 100 * 1024 * 1024,
        segmentBytes = 10 * 1024 * 1024,
        scope = "app",
        context = {},
        root = null,
    } = {}) {
        this.logsDirectory = path.resolve(logsDirectory);
        this.level = levels[level] ? level : "info";
        this.retentionDays = retentionDays;
        this.maximumBytes = maximumBytes;
        this.segmentBytes = segmentBytes;
        this.scope = scope;
        this.context = context;
        this.root = root ?? this;
    }


    child(scope, context = {}) {
        return new AppLogger({
            logsDirectory: this.logsDirectory,
            level: this.root.level,
            retentionDays: this.retentionDays,
            maximumBytes: this.maximumBytes,
            segmentBytes: this.segmentBytes,
            scope: String(scope || this.scope),
            context: { ...this.context, ...sanitize(context) },
            root: this.root,
        });
    }


    subscribe(listener) {
        this.root.#listeners.add(listener);
        return () => this.root.#listeners.delete(listener);
    }


    setLevel(level) {
        this.root.level = levels[level] ? level : "info";
        return this.root.level;
    }


    runWithContext(context, operation) {
        return this.root.#storage.run({
            ...(this.root.#storage.getStore() ?? {}),
            ...sanitize(context),
        }, operation);
    }


    debug(event, message, fields) { return this.#log("debug", event, message, fields); }
    info(event, message, fields) { return this.#log("info", event, message, fields); }
    warn(event, message, fields) { return this.#log("warn", event, message, fields); }
    error(event, message, fields) { return this.#log("error", event, message, fields); }


    #log(level, event, message, fields = {}) {
        if (levels[level] < levels[this.root.level]) return null;
        // Підтримуємо старий контракт logger.info(message).
        if (message === undefined) {
            message = event;
            event = "message";
        }
        const rawEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            level,
            scope: this.scope,
            event: String(event || "message"),
            message: String(message ?? ""),
            context: {
                ...this.context,
                ...(this.root.#storage.getStore() ?? {}),
            },
            fields,
        };
        const entry = sanitize(rawEntry);
        this.root.#writeQueue = this.root.#writeQueue.then(
            () => this.root.#write(entry),
            () => this.root.#write(entry)
        );
        const safe = safeRendererEvent(rawEntry);
        this.root.#listeners.forEach((listener) => {
            try { listener(safe); } catch { /* listener не блокує logger */ }
        });
        return safe;
    }


    async initialize() {
        try {
            await mkdir(this.logsDirectory, { recursive: true });
            await this.cleanup();
        } catch (error) {
            this.#notifyFileWarning(error, "logger.initialize.failed");
        }
    }


    async #write(entry) {
        try {
            await mkdir(this.logsDirectory, { recursive: true });
            const { file, rotated } = await this.#currentFile(entry.timestamp.slice(0, 10));
            await appendFile(file, `${JSON.stringify(entry)}\n`, "utf8");
            if (rotated) await this.cleanup();
            this.#fileWarningSent = false;
        } catch (error) {
            this.#notifyFileWarning(error, "logger.write.failed");
        }
    }


    #notifyFileWarning(error, event) {
        if (this.#fileWarningSent) return;
        this.#fileWarningSent = true;
        process.stderr.write(`AdsBot logger: ${redactString(error.message)}\n`);
        const warning = safeRendererEvent({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            level: "warn",
            scope: "logger",
            event,
            message: "Файловий журнал недоступний; програма продовжує роботу",
            context: {},
            fields: { error },
        });
        this.#listeners.forEach((listener) => {
            try { listener(warning); } catch { /* listener не блокує logger */ }
        });
    }


    async #currentFile(date) {
        let part = 0;
        while (true) {
            const suffix = part ? `-${part}` : "";
            const file = path.join(this.logsDirectory, `adsbot-${date}${suffix}.jsonl`);
            try {
                if ((await stat(file)).size < this.segmentBytes) return { file, rotated: false };
                part += 1;
            } catch (error) {
                if (error.code === "ENOENT") return { file, rotated: part > 0 };
                throw error;
            }
        }
    }


    async cleanup(now = Date.now()) {
        let files;
        try {
            files = (await readdir(this.logsDirectory, { withFileTypes: true }))
                .filter((item) => item.isFile() && logFilePattern.test(item.name));
        } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
        }
        const items = await Promise.all(files.map(async (item) => {
            const file = path.join(this.logsDirectory, item.name);
            const info = await stat(file);
            return { file, name: item.name, size: info.size, mtimeMs: info.mtimeMs };
        }));
        const cutoff = now - this.retentionDays * 86400000;
        for (const item of items.filter((entry) => entry.mtimeMs < cutoff)) {
            await rm(item.file, { force: true });
        }
        const remaining = items.filter((entry) => entry.mtimeMs >= cutoff)
            .sort((left, right) => right.mtimeMs - left.mtimeMs);
        let total = remaining.reduce((sum, item) => sum + item.size, 0);
        for (const item of [...remaining].reverse()) {
            if (total <= this.maximumBytes) break;
            await rm(item.file, { force: true });
            total -= item.size;
        }
    }


    async list({ cursor = null, limit = 100, levels: selectedLevels, scopes, query = "", dateFrom, dateTo, taskId, taskType, accountKey, jobId } = {}) {
        await this.flush();
        const files = (await readdir(this.logsDirectory, { withFileTypes: true }))
            .filter((item) => item.isFile() && logFilePattern.test(item.name))
            .map((item) => item.name)
            .sort(logFileOrder);
        const needle = String(query).trim().toLowerCase();
        const normalizedDateTo = /^\d{4}-\d{2}-\d{2}$/.test(String(dateTo ?? ""))
            ? `${dateTo}T23:59:59.999Z`
            : dateTo;
        const matches = (entry) => (
            (!selectedLevels?.length || selectedLevels.includes(entry.level))
            && (!scopes?.length || scopes.includes(entry.scope))
            && (!dateFrom || entry.timestamp >= dateFrom)
            && (!normalizedDateTo || entry.timestamp <= normalizedDateTo)
            && (!taskId || entry.context?.taskId === taskId)
            && (!taskType || entry.context?.taskType === taskType)
            && (!accountKey || entry.context?.accountKey === accountKey)
            && (!jobId || entry.context?.jobId === jobId)
            && (!needle || JSON.stringify(safeRendererEvent(entry)).toLowerCase().includes(needle))
        );
        const normalizedLimit = Math.min(250, Math.max(1, Number(limit) || 100));
        const start = cursor ? decodeCursor(cursor) : { fileIndex: 0, lineIndex: null };
        const items = [];
        for (let fileIndex = start.fileIndex; fileIndex < files.length; fileIndex += 1) {
            const lines = (await readFile(path.join(this.logsDirectory, files[fileIndex]), "utf8"))
                .split(/\r?\n/);
            const firstLine = fileIndex === start.fileIndex && start.lineIndex !== null
                ? Math.min(start.lineIndex, lines.length - 1)
                : lines.length - 1;
            for (let lineIndex = firstLine; lineIndex >= 0; lineIndex -= 1) {
                if (!lines[lineIndex]) continue;
                let entry;
                try { entry = JSON.parse(lines[lineIndex]); } catch { continue; }
                if (!matches(entry)) continue;
                items.push(safeRendererEvent(entry));
                if (items.length >= normalizedLimit) {
                    const hasMore = lineIndex > 0 || fileIndex + 1 < files.length;
                    return {
                        items,
                        nextCursor: hasMore ? encodeCursor({
                            fileIndex: lineIndex > 0 ? fileIndex : fileIndex + 1,
                            lineIndex: lineIndex > 0 ? lineIndex - 1 : null,
                        }) : null,
                    };
                }
            }
        }
        return { items, nextCursor: null };
    }


    async scopes() {
        const result = new Set();
        let cursor = null;
        do {
            const page = await this.list({ cursor, limit: 250 });
            page.items.forEach((item) => result.add(item.scope));
            cursor = page.nextCursor;
        } while (cursor);
        return [...result].sort();
    }


    flush() {
        return this.root.#writeQueue;
    }


    installConsoleBridge(scope = "console") {
        const target = this.child(scope);
        const original = {
            log: console.log,
            info: console.info,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        };
        const format = (items) => items.map((item) => (
            item instanceof Error
                ? item.message
                : typeof item === "string"
                    ? item
                    : JSON.stringify(sanitize(item))
        )).join(" ");
        console.log = (...items) => target.info("console.log", format(items));
        console.info = (...items) => target.info("console.info", format(items));
        console.warn = (...items) => target.warn("console.warn", format(items));
        console.error = (...items) => target.error("console.error", format(items), {
            error: items.find((item) => item instanceof Error),
        });
        console.debug = (...items) => target.debug("console.debug", format(items));
        return () => Object.assign(console, original);
    }
}


export { redactString, sanitize, safeRendererEvent };
