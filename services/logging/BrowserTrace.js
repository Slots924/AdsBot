import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { facebookTranslations } from "../../facebook/i18n/index.js";
import { inspectTraceDom, maskTraceScreenshot } from "../../facebook/browser/inspectTraceDom.js";
import { bindBrowserTrace } from "./browserTraceContext.js";
import * as profileSelectors from "../../facebook/selectors/profile.js";
import * as aboutSelectors from "../../facebook/selectors/personalProfileAbout.js";
import * as postSelectors from "../../facebook/selectors/personalProfilePost.js";
import * as modalSelectors from "../../facebook/selectors/postPublishModals.js";
import * as accountSelectors from "../../facebook/selectors/accountCenter.js";

const strings = (value) => typeof value === "string" ? [value]
    : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const selectorTexts = strings([profileSelectors, aboutSelectors, postSelectors, modalSelectors, accountSelectors])
    .flatMap((selector) => [...selector.matchAll(/\[aria-label="([^"]+)"/g)].map((match) => match[1]));

export default class BrowserTrace {
    constructor({ directory = "./data/browser-traces", enabled = true, uiTexts = [],
        sensitiveTexts = [], maxSnapshots = 160, maxEvents = 2500, maxFailures = 30,
        maxBytes = 20 * 1024 * 1024 } = {}) {
        this.enabled = enabled;
        this.directory = path.resolve(directory, randomUUID());
        this.uiTexts = [...new Set([...strings(facebookTranslations), ...selectorTexts, ...uiTexts])];
        this.sensitiveTexts = strings(sensitiveTexts).filter((value) => value.length > 2).sort((a, b) => b.length - a.length);
        this.limits = { maxSnapshots, maxEvents, maxFailures, maxBytes };
        this.snapshots = new Set();
        this.steps = [];
        this.failures = [];
        this.count = 0;
        this.bytes = 0;
        this.dropped = 0;
        this.errors = 0;
        this.dialogs = new Map();
        this.failureKeys = new Map();
        this.queue = Promise.resolve();
    }

    clean(value) {
        let result = String(value ?? "");
        for (const secret of this.sensitiveTexts) {
            const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            result = result.replace(new RegExp(escaped, "giu"), "[приховано]");
        }
        return result.replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
            .replace(/[\w.+-]+@[\w.-]+\.[\p{L}]{2,}/gu, "[email]")
            .replace(/\b[A-Za-z0-9_-]{35,}\b/g, "[token]")
            .replace(/\b(password|token|cookie|authorization|proxy)\s*[:=]\s*\S+/gi, "$1=[приховано]")
            .replace(/[\r\n]+/g, " ").slice(0, 1500);
    }

    safe(operation) {
        if (!this.enabled) return Promise.resolve(null);
        const pending = this.queue.then(operation).catch(() => { this.errors += 1; return null; });
        this.queue = pending;
        return pending;
    }

    async write(relative, data, append = false) {
        const size = Buffer.byteLength(data);
        if (this.bytes + size > this.limits.maxBytes) { this.dropped += 1; return false; }
        const file = path.join(this.directory, relative);
        await mkdir(path.dirname(file), { recursive: true });
        if (append) await appendFile(file, data);
        else await writeFile(file, data);
        this.bytes += size;
        return true;
    }

    async record(type, fields = {}) {
        if (this.count >= this.limits.maxEvents) { this.dropped += 1; return; }
        this.count += 1;
        // Передаємо лише явно вибрані технічні поля, а не результати action чи logger цілком.
        await this.write("events.jsonl", JSON.stringify({
            at: new Date().toISOString(), step: this.currentStep ?? null, type, ...fields,
        }) + "\n", true);
    }

    event(type, { point, selector, expected, status, code, attempt, sequence } = {}) {
        return this.safe(() => this.record(type, {
            point: point ? this.clean(point) : undefined,
            selector: selector ? this.clean(selector) : undefined,
            expected: expected ? this.clean(expected) : undefined,
            status: status ? this.clean(status) : undefined,
            code: code ? this.clean(code) : undefined, attempt, sequence,
        }));
    }

    async capture(page, { point, selector = null } = {}) {
        if (this.count >= this.limits.maxEvents || this.bytes >= this.limits.maxBytes) {
            this.dropped += 1;
            return null;
        }
        const snapshot = await page.evaluate(inspectTraceDom, {
            uiTexts: this.uiTexts, sensitiveTexts: this.sensitiveTexts, selector,
            aboutPanelSelector: aboutSelectors.personalProfileAboutPanelSelector,
        });
        if (!snapshot?.elements || !snapshot?.dialogs) throw new Error("Немає знімка DOM");
        const content = JSON.stringify(snapshot, null, 2);
        const hash = createHash("sha256").update(content).digest("hex").slice(0, 24);
        if (!this.snapshots.has(hash)) {
            if (this.snapshots.size >= this.limits.maxSnapshots) { this.dropped += 1; return null; }
            if (!await this.write(`snapshots/${hash}.json`, content)) return null;
            this.snapshots.add(hash);
        }
        await this.record("observation", { point: this.clean(point), snapshot: hash });
        if (snapshot.dialogs.length) {
            const shape = JSON.stringify({ dialogs: snapshot.dialogs,
                controls: snapshot.elements.map(({ tag, role, label, text }) => ({ tag, role, label, text })) });
            const signature = createHash("sha256").update(shape).digest("hex").slice(0, 16);
            if (!this.dialogs.has(signature)) this.dialogs.set(signature, { snapshot: hash, count: 0 });
            this.dialogs.get(signature).count += 1;
        }
        return { hash, snapshot };
    }

    observe(page, options = {}) {
        return this.safe(() => this.capture(page, options));
    }

    failure(page, { point = "failed", selector, error, status } = {}) {
        return this.safe(async () => {
            if (this.failures.length >= this.limits.maxFailures) { this.dropped += 1; return; }
            const id = String(this.failures.length + 1).padStart(3, "0");
            const detail = { id, step: this.currentStep, point: this.clean(point),
                status: this.clean(status), code: this.clean(error?.code),
                message: this.clean(error?.message), selector: this.clean(selector ?? error?.selector) };
            let captured;
            try { captured = await this.capture(page, { point, selector: selector ?? error?.selector }); }
            catch { this.errors += 1; }
            detail.snapshot = captured?.hash ?? null;
            const key = JSON.stringify([detail.step, detail.point, detail.code, detail.status, detail.snapshot]);
            const previous = this.failureKeys.get(key);
            if (previous && detail.snapshot) {
                previous.repeats = (previous.repeats ?? 1) + 1;
                await this.record("failure.repeated", { id: previous.id, repeats: previous.repeats });
                return;
            }
            this.failures.push(detail);
            this.failureKeys.set(key, detail);
            await this.write(`failures/${id}/details.json`, JSON.stringify(detail, null, 2));
            if (captured) {
                // Безпечне HTML-представлення діагностичного дерева, без живих скриптів і даних форм.
                const html = captured.snapshot.elements.map((element) =>
                    `<div data-node="${element.id}" data-tag="${escapeHtml(element.tag)}" role="${escapeHtml(element.role ?? "")}" aria-label="${escapeHtml(element.label)}">${escapeHtml(element.text)}</div>`
                ).join("\n");
                await this.write(`failures/${id}/fragment.html`, html);
            }
            const token = randomUUID();
            let masksInstalled = false;
            try {
                // Маскування знімка обов’язкове; у разі помилки сирий screenshot не створюємо.
                masksInstalled = true;
                await page.evaluate(maskTraceScreenshot, { token, uiTexts: this.uiTexts });
                const screenshot = await page.screenshot({ type: "png", fullPage: false });
                const sameDocument = await page.evaluate((maskToken) => Boolean(
                    document.querySelector(`[data-adsbot-trace-mask="${maskToken}"]`)
                ), token);
                if (sameDocument) await this.write(`failures/${id}/screenshot.png`, Buffer.from(screenshot));
            } catch { this.errors += 1; }
            finally {
                if (masksInstalled) await page.evaluate(maskTraceScreenshot, { token, remove: true }).catch(() => {});
            }
            await this.record("failure", detail);
        });
    }

    async step(page, { id, goal = id }, action) {
        if (!this.enabled) return action();
        const restore = bindBrowserTrace(page, this);
        const previous = this.currentStep;
        this.currentStep = id;
        const entry = { id, goal, status: "running" };
        this.steps.push(entry);
        await this.event("step.started", { point: goal });
        await this.observe(page, { point: "before" });
        try {
            const result = await action();
            entry.status = result?.success === false ? "failed" : "completed";
            if (entry.status === "failed") await this.failure(page, { point: "result", status: result.status, error: result.error });
            else await this.observe(page, { point: "after" });
            await this.event("step.finished", { status: entry.status });
            return result;
        } catch (error) {
            entry.status = "failed";
            await this.failure(page, { point: "exception", error });
            throw error;
        } finally {
            this.currentStep = previous;
            restore();
        }
    }

    finish(outcome) {
        return this.safe(async () => {
            await this.record("run.finished", { status: this.clean(outcome) });
            const lines = ["# Журнал браузерного оформлення акаунта", "",
                `Результат: ${this.clean(outcome)}`, "", "## Кроки", "",
                ...this.steps.map((step) => `- ${step.id}: ${step.status}`), "", "## Збої", "",
                ...this.failures.map((item) => `- [${item.id}: ${item.step ?? item.point}](failures/${item.id}/details.json) — ${item.code || item.status || "помилка"}, повторів: ${item.repeats ?? 1}`),
                "", "## Варіанти діалогів", "",
                ...[...this.dialogs].map(([signature, item]) => `- ${signature}: [зразок](snapshots/${item.snapshot}.json), спостережень: ${item.count}`),
                "", "Читайте потрібний details.json, потім його snapshot. events.jsonl містить послідовність дій.",
                "Тексти форм очищені, довільні тексти поза формами приховані. fragment.html — діагностичне дерево, не копія сторінки.",
                `Унікальних знімків: ${this.snapshots.size}. Пропущено через ліміти: ${this.dropped}. Помилок запису: ${this.errors}.`, ""];
            // Підсумок має залишитися доступним навіть після вичерпання ліміту доказів.
            await mkdir(this.directory, { recursive: true });
            await writeFile(path.join(this.directory, "summary.md"), lines.join("\n"));
            return path.join(this.directory, "summary.md");
        });
    }
}
