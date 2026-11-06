import { app, BrowserWindow } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import os from "node:os";

app.setPath("userData", mkdtempSync(path.join(os.tmpdir(), "adsbot-adsets-review-")));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "artifacts/adsets-ui-review");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let window;
async function review() {
try {
    await app.whenReady();
    await mkdir(output, { recursive: true });
    window = new BrowserWindow({ show: false, width: 1600, height: 1000, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
    const errors = [];
    window.webContents.on("console-message", (_event, details) => { if (details.level === "error") errors.push(details.message); });
    await window.loadFile(path.join(root, "frontend/dist/index.html"), { query: { "adsets-ui": "1" } });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await window.webContents.executeJavaScript('Boolean(document.querySelector(".campaign-expand-button"))')) break;
        await wait(100);
    }
    await window.webContents.executeJavaScript('document.querySelector(".campaign-expand-button").click()');
    await wait(800);
    await writeFile(path.join(output, "adsets-wide.png"), (await window.webContents.capturePage()).toPNG());
    const checks = await window.webContents.executeJavaScript(`({ rows: document.querySelectorAll('.adset-row').length, documentOverflow: document.documentElement.scrollWidth > innerWidth, hidden: document.visibilityState, buttons: document.querySelectorAll('.adset-copy-button').length, deleteButtons: document.querySelectorAll('.adset-actions .campaign-delete-button').length, actionsFit: [...document.querySelectorAll('.adset-actions')].every(cell => { const row = cell.closest('.adset-row').getBoundingClientRect(); const rect = cell.getBoundingClientRect(); return rect.right <= row.right; }) })`);
    await window.webContents.executeJavaScript('document.querySelector(".adset-copy-button").click()');
    await wait(200);
    await writeFile(path.join(output, "duplicate-wide.png"), (await window.webContents.capturePage()).toPNG());
    window.setSize(1100, 800);
    await wait(300);
    await writeFile(path.join(output, "duplicate-compact.png"), (await window.webContents.capturePage()).toPNG());
    const modal = await window.webContents.executeJavaScript(`(() => { const modal = document.querySelector('[role=dialog]'); const rect = modal.getBoundingClientRect(); return { fits: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, switchEnabled: modal.querySelector('[role=switch]').checked }; })()`);
    await window.webContents.executeJavaScript('document.querySelector("[role=dialog] .modal-close").click()');
    await wait(300);
    await writeFile(path.join(output, "adsets-compact.png"), (await window.webContents.capturePage()).toPNG());
    window.setSize(1600, 1000);
    await wait(150);
    await window.webContents.executeJavaScript('document.querySelectorAll(".adset-row [role=switch]").forEach(button => button.click())');
    await wait(150);
    const pending = await window.webContents.executeJavaScript(`({ count: document.querySelectorAll('.adset-row .campaign-state-toggle.pending').length, states: [...document.querySelectorAll('.adset-row [role=switch]')].map(button => button.getAttribute('aria-checked')), spinners: document.querySelectorAll('.adset-row .entity-status-progress .spin').length })`);
    await writeFile(path.join(output, "adsets-pending.png"), (await window.webContents.capturePage()).toPNG());
    if (pending.count !== 2 || pending.spinners !== 2 || pending.states.join(',') !== 'false,true') throw new Error(JSON.stringify(pending));
    if (checks.rows !== 2 || checks.documentOverflow || checks.deleteButtons !== 2 || !checks.actionsFit || !modal.fits || !modal.switchEnabled || errors.length) throw new Error(JSON.stringify({ checks, modal, errors }));
    console.log(JSON.stringify({ visible: window.isVisible(), checks, modal, pending, errors, screenshots: output }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { window?.destroy(); app.quit(); }
}
review();
