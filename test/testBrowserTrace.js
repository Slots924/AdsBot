import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import BrowserTrace from "../services/logging/BrowserTrace.js";
import { getBrowserTrace } from "../services/logging/browserTraceContext.js";
import { inspectTraceDom, maskTraceScreenshot } from "../facebook/browser/inspectTraceDom.js";

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-browser-trace-"));
const snapshot = { readyState: "interactive", loading: false,
    dialogs: [{ role: "dialog", title: "Name", label: "Name" }],
    elements: [{ id: 1, tag: "button", role: "button", label: "Save", text: "Save", visible: true }],
    target: null, truncated: false };
const createPage = () => ({
    masked: false, removed: 0, captures: 0,
    async evaluate(callback, options) {
        if (callback === inspectTraceDom) { this.captures += 1; return snapshot; }
        if (callback === maskTraceScreenshot) {
            this.masked = !options.remove;
            if (options.remove) this.removed += 1;
            return;
        }
        return this.masked;
    },
    async screenshot() {
        assert.equal(this.masked, true);
        return Buffer.from("masked screenshot");
    },
});

try {
    const page = createPage();
    const trace = new BrowserTrace({ directory, sensitiveTexts: ["Private Person"] });
    const result = { success: false, status: "PARTIAL", error: {
        code: "ABOUT_FAILED", message: "Private Person https://example.test/?token=secret person@example.test",
    } };
    assert.equal(await trace.step(page, { id: "about" }, async () => {
        assert.equal(getBrowserTrace(page), trace);
        await trace.observe(page, { point: "form" });
        await trace.observe(page, { point: "form-again" });
        return result;
    }), result);
    assert.equal(getBrowserTrace(page), undefined);
    const summaryPath = await trace.finish("completed_with_error");
    assert.match(await readFile(summaryPath, "utf8"), /about: failed/);
    assert.equal((await readdir(path.join(trace.directory, "snapshots"))).length, 1);
    const events = (await readFile(path.join(trace.directory, "events.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.filter((event) => event.type === "observation").length, 4);
    assert.equal(events.filter((event) => event.type === "failure").length, 1);
    const detail = await readFile(path.join(trace.directory, "failures/001/details.json"), "utf8");
    assert.doesNotMatch(detail, /Private Person|person@example|token=secret/);
    assert.equal(page.removed, 1);
    assert.equal(page.masked, false);
    assert.equal(await readFile(path.join(trace.directory, "failures/001/screenshot.png"), "utf8"), "masked screenshot");
    await trace.failure(page, { point: "result", status: result.status, error: result.error });
    const failureCount = trace.failures.length;
    await trace.failure(page, { point: "result", status: result.status, error: result.error });
    assert.equal(trace.failures.length, failureCount);
    assert.equal(trace.failures.at(-1).repeats, 2);

    const thrown = new Error("action failed");
    await assert.rejects(() => trace.step(page, { id: "throws" }, async () => { throw thrown; }), (error) => error === thrown);
    assert.equal(getBrowserTrace(page), undefined);

    const limited = new BrowserTrace({ directory, maxSnapshots: 0, maxEvents: 2, maxFailures: 1 });
    await limited.observe(page);
    await limited.failure(page, { point: "one" });
    await limited.failure(page, { point: "two" });
    await limited.event("extra");
    await limited.finish("failed");
    assert.equal(limited.snapshots.size, 0);
    assert.equal(limited.failures.length, 1);
    assert.ok(limited.dropped > 0);

    // Помилка диска не змінює результат бізнес-операції.
    const blocker = path.join(directory, "file-instead-of-directory");
    await writeFile(blocker, "file");
    const broken = new BrowserTrace({ directory: blocker });
    assert.equal(await broken.step(page, { id: "io-failure" }, async () => result), result);
    assert.ok(broken.errors > 0);

    const disabled = new BrowserTrace({ directory, enabled: false });
    const captureCount = page.captures;
    assert.equal(await disabled.step(page, { id: "disabled" }, async () => result), result);
    assert.equal(page.captures, captureCount);

    // Два профілі не змішують поточні кроки та матеріали.
    const second = new BrowserTrace({ directory });
    const otherPage = createPage();
    await Promise.all([
        trace.step(page, { id: "first-profile" }, async () => {
            assert.equal(getBrowserTrace(page), trace);
            return { success: true };
        }),
        second.step(otherPage, { id: "second-profile" }, async () => {
            assert.equal(getBrowserTrace(otherPage), second);
            return { success: true };
        }),
    ]);
    assert.notEqual(trace.directory, second.directory);

    const maskErrorPage = createPage();
    let screenshotCalled = false;
    maskErrorPage.evaluate = async (callback, options) => {
        if (callback === inspectTraceDom) return snapshot;
        if (callback === maskTraceScreenshot && !options.remove) throw new Error("mask failed");
    };
    maskErrorPage.screenshot = async () => { screenshotCalled = true; };
    await second.failure(maskErrorPage, { point: "mask-failure" });
    assert.equal(screenshotCalled, false);
} finally {
    await rm(directory, { recursive: true, force: true });
}
console.log("BrowserTrace tests passed");
