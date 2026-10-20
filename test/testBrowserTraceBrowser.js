import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import BrowserTrace from "../services/logging/BrowserTrace.js";
import waitForUiReady from "../facebook/browser/waitForUiReady.js";
import { inspectTraceDom, maskTraceScreenshot } from "../facebook/browser/inspectTraceDom.js";
import { aboutDomRuntime } from "../facebook/actions/fillFacebookPersonalProfileAbout.js";

const candidates = [process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean);
let executablePath;
for (const candidate of candidates) {
    if (await access(candidate).then(() => true, () => false)) { executablePath = candidate; break; }
}
if (!executablePath) {
    console.log("Browser trace browser test skipped: set CHROME_PATH");
} else {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-trace-browser-"));
    let browser;
    try {
        browser = await puppeteer.launch({ executablePath, headless: true,
            userDataDir: path.join(directory, "browser"),
            args: ["--disable-background-networking", "--disable-extensions", "--no-first-run"] });
        const page = await browser.newPage();
        await page.setContent(`<main><div role="dialog" aria-label="Name">
            <h2>Name</h2><p>PRIVATE PERSON private@example.test</p>
            <input aria-label="First name" value="PRIVATE PERSON">
            <button id="save" role="button" aria-label="Save" disabled>Save</button>
            <button style="display:none">Hidden</button>
        </div></main>`);
        await page.evaluate(() => {
            setTimeout(() => {
                const original = document.querySelector("#save");
                const fresh = original.cloneNode(true);
                original.replaceWith(fresh);
                fresh.disabled = false;
            }, 120);
        });
        await waitForUiReady(page, "#save", { timeout: 4000 });
        assert.equal(await page.$eval("#save", (node) => node.disabled), false);
        const snapshot = await page.evaluate(inspectTraceDom, { uiTexts: ["Name", "Save", "First name"], selector: "#save" });
        assert.equal(snapshot.target.candidates[0].enabled, true);
        assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|private@example/);
        assert.equal(snapshot.elements.some((node) => node.text === "Hidden"), false);

        await page.evaluate(maskTraceScreenshot, { token: "test", uiTexts: ["Save", "Name"] });
        assert.ok(await page.$$eval('[data-adsbot-trace-mask="test"]', (nodes) => nodes.length) > 1);
        await page.evaluate(maskTraceScreenshot, { token: "test", remove: true });
        const trace = new BrowserTrace({ directory, uiTexts: ["Save", "Name"] });
        await trace.step(page, { id: "about" }, async () => ({ success: false, status: "PARTIAL" }));
        await trace.finish("completed_with_error");
        const screenshot = await readFile(path.join(trace.directory, "failures/001/screenshot.png"));
        assert.equal(screenshot.subarray(1, 4).toString(), "PNG");
        assert.equal(await page.$$eval("[data-adsbot-trace-mask]", (nodes) => nodes.length), 0);

        // Перевіряємо виконання рекурсивного сканера після серіалізації Puppeteer.
        const ready = await page.waitForFunction(aboutDomRuntime, { timeout: 3000, polling: 50 }, {
            mode: "find", kind: "selector", selector: "#save", stableToken: "about-test",
        });
        await ready.dispose();
        await page.setContent('<main><section><h2>Work</h2><p>Empty section</p></section></main>');
        assert.equal(await page.evaluate(aboutDomRuntime, {
            mode: "inspect", kind: "workSaveOutcome", selectors: { save: "button.save", editWorkplace: "button.edit" },
        }), false);
        await page.evaluate(() => {
            const button = document.createElement("button");
            button.className = "edit";
            button.textContent = "Edit workplace";
            document.querySelector("section").append(button);
        });
        assert.equal((await page.evaluate(aboutDomRuntime, {
            mode: "inspect", kind: "workSaveOutcome", selectors: { save: "button.save", editWorkplace: "button.edit" },
        })).saved, true);
        console.log("Browser trace and About checks passed in isolated Chromium");
    } finally {
        await browser?.close();
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
}
