import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { cleanHistory, collectSecrets, requestSnapshot, responseSnapshot } from "./httpHistoryPolicy.js";

const storage = new AsyncLocalStorage();
const metadataFields = value => Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item != null));

class Journal {
    constructor(options) {
        this.id = randomUUID();
        this.file = path.resolve(options.directory ?? "./data/reports/http", `${this.id}.jsonl`);
        this.metadata = cleanHistory(options.metadata ?? {});
        this.requests = 0;
        this.events = 0;
        this.queue = Promise.resolve();
        this.persistent = options.persistent === true;
        this.onStart = options.onStart;
        this.storageError = null;
    }
    async append(event) {
        if (!this.persistent || !this.requests) return;
        const write = async () => {
            if (!this.events) {
                await mkdir(path.dirname(this.file), { recursive: true });
                await appendFile(this.file, `${JSON.stringify({ event: "history.started", version: 1, historyId: this.id, at: new Date().toISOString(), ...this.metadata })}\n`, "utf8");
                await this.onStart?.(this.reference());
            }
            await appendFile(this.file, `${JSON.stringify(event)}\n`, "utf8");
            this.events++;
        };
        const operation = this.queue.then(write);
        this.queue = operation.catch(() => {});
        // Збій диска не змінює підтверджений Facebook результат і не запускає повтор mutation.
        try { await operation; }
        catch { this.storageError = "Не вдалося повністю записати HTTP-історію"; }
    }
    reference() {
        return { id: this.id, path: this.file, requestCount: this.requests, format: "jsonl", version: 1,
            ...(this.storageError ? { storageWarning: this.storageError } : {}) };
    }
}

export function currentHttpHistory() {
    const journal = storage.getStore()?.journal;
    return journal?.persistent ? journal.reference() : null;
}

// У сховища стану й IPC потрапляє посилання; повна історія залишається в одному артефакті.
export function compactHttpHistory(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(compactHttpHistory);
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "exchanges").map(([key, item]) => [key, compactHttpHistory(item)]));
}

export async function withHttpAction(name, execute, metadata = {}) {
    const parent = storage.getStore();
    const scope = { journal: parent?.journal ?? new Journal({}), parent, actionId: randomUUID(), name,
        exchanges: [], metadata: cleanHistory({ ...parent?.metadata, ...metadataFields(metadata) }), secrets: new Set(parent?.secrets ?? []) };
    return storage.run(scope, async () => {
        let result;
        try {
            result = await execute();
            await scope.journal.append({ event: "action.finished", actionId: scope.actionId, action: name,
                at: new Date().toISOString(), ...scope.metadata,
                result: cleanHistory({ success: result?.success, status: result?.status, graphCode: result?.graphCode,
                    outcome: result?.outcome, code: result?.code, message: result?.message,
                    outcomeUnknown: result?.outcomeUnknown, stage: result?.stage, sessionFieldsFound: result?.fields,
                    adsManagerPrepared: result?.hasAdsManagerSession, credentialObtained: result?.hasAccessToken }, [...scope.secrets]) });
            return result && typeof result === "object" ? { ...result, actionId: scope.actionId, exchanges: scope.exchanges,
                ...(currentHttpHistory() ? { httpHistory: currentHttpHistory() } : {}) } : result;
        } catch (error) {
            error.actionId = scope.actionId;
            error.exchanges = scope.exchanges;
            await scope.journal.append({ event: "action.failed", actionId: scope.actionId, action: name,
                at: new Date().toISOString(), ...scope.metadata, code: error.code ?? null });
            throw error;
        }
    });
}

// Workflow задає політику збереження; вкладені workflow використовують спільний журнал.
export async function withHttpWorkflow(name, execute, options = {}) {
    if (options.enabled === false) return execute();
    if (storage.getStore()?.journal.persistent) {
        const parent = storage.getStore();
        return storage.run({ ...parent, metadata: cleanHistory({ ...parent.metadata, ...metadataFields(options.metadata) }) }, async () => {
            const result = await execute();
            return result && typeof result === "object" && parent.journal.requests
                ? { ...compactHttpHistory(result), httpHistory: currentHttpHistory() } : result;
        });
    }
    const journal = new Journal({ ...options, metadata: { workflow: name, ...options.metadata }, persistent: true });
    const scope = { journal, actionId: null, name, exchanges: null, secrets: new Set(), metadata: cleanHistory(options.metadata ?? {}) };
    return storage.run(scope, async () => {
        const attach = value => {
            if (!value || typeof value !== "object" || !journal.requests) return value;
            return { ...compactHttpHistory(value), httpHistory: journal.reference(),
                ...(journal.storageError ? { taskStatus: "completed_with_warnings" } : {}) };
        };
        try {
            const result = await execute();
            if (journal.requests) await journal.append({ event: "history.finished", at: new Date().toISOString() });
            return attach(result);
        } catch (error) {
            if (journal.requests) {
                await journal.append({ event: "history.failed", at: new Date().toISOString(), code: error.code ?? null });
                error.httpHistory = journal.reference();
                error.result = attach(error.result ?? {});
            }
            throw error;
        }
    });
}

export async function traceHttpRequest(config, execute, { attempt = 1, requestGroupId = null } = {}) {
    const scope = storage.getStore();
    if (!scope || !/(^|\.)facebook\.com$|(^|\.)fbcdn\.net$/i.test(new URL(config.url).hostname)) return execute();
    const requestId = randomUUID();
    const started = Date.now();
    const request = requestSnapshot(config);
    try { collectSecrets(Object.fromEntries(new URL(config.url).searchParams), scope.secrets); } catch {}
    collectSecrets(request, scope.secrets);
    const clean = value => cleanHistory(value, [...scope.secrets]);
    scope.journal.requests++;
    const base = { requestId, requestGroupId, attempt, sequence: scope.journal.requests, actionId: scope.actionId,
        parentActionId: scope.parent?.actionId ?? null, action: scope.name, ...scope.metadata };
    // Намір записується до мережевого виклику, відповідь — до запуску парсера екшену.
    await scope.journal.append({ event: "request.started", ...base, at: new Date(started).toISOString(), request: clean(request) });
    let response, error;
    try { response = await execute(); }
    catch (caught) { error = caught; response = caught.response; }
    const snapshot = response ? responseSnapshot(response, config) : null;
    collectSecrets(snapshot, scope.secrets);
    const exchange = clean({ ...base, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
        request, response: snapshot,
        error: error ? { name: error.name, code: error.code ?? null,
            message: response ? `HTTP ${response.status}` : "Відповідь не отримана", cancelled: config.signal?.aborted === true } : null });
    for (let current = scope; current; current = current.parent) current.exchanges?.push(exchange);
    await scope.journal.append({ event: "request.finished", ...exchange });
    if (error) throw error;
    return response;
}

// Реальний ProxyHttpClient записує кожну спробу; mock-клієнти обгортаються тут.
export function requestWithTrace(client, config, options) {
    return client.supportsExchangeTrace ? client.request(config, options)
        : traceHttpRequest(config, () => client.request(config, options));
}

export function tracedAction(name, execute, metadata = () => ({})) {
    return (...args) => withHttpAction(name, () => execute(...args), metadata(...args));
}
