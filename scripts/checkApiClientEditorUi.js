import assert from "node:assert/strict";
import { mkdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";

// Ізольоване прев’ю використовує лише вигадані дані та не звертається до API.
const fixture = `import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from '/src/components/Sidebar.jsx';
import '/src/styles/shared-ui.css';
import '/src/styles/app.css';
const credentials = { accessToken: 'mock-access-token', userAgent: 'Mock UA', cookie: 'c_user=1', afpToken: 'mock-afp-token' };
window.adsBot = { getAccountEditorCredentials: async () => ({ ok: true, data: credentials }) };
function Preview() {
    const [accounts, setAccounts] = useState([{ accountKey: 'account-001', kind: 'api', name: 'Demo API client', tokenMode: 'access', adsPowerProfileNo: '123', hasAccessToken: true, hasUserAgent: true, hasCookie: true, hasAfpToken: true, status: 'active' }]);
    return <div style={{ width: 'min(400px, 100%)', height: '100vh', padding: 16 }}><Sidebar standalone accounts={accounts} onRefresh={() => {}} onSelect={() => {}} onCreate={async () => {}} onUpdate={async (key, patch) => setAccounts((items) => items.map((item) => item.accountKey === key ? { ...item, ...patch } : item))} onError={(error) => { throw new Error(error.message); }} /></div>;
}
createRoot(document.getElementById('root')).render(<Preview />);
const pause = () => new Promise((resolve) => setTimeout(resolve, 500));
async function check() {
    await pause();
    const mode = new URLSearchParams(location.search).get('mode');
    if (mode === 'card') {
        document.querySelector('.account-card-token-mode button:last-child').click();
        await pause();
        const toggle = document.querySelector('.account-card-token-mode').getBoundingClientRect();
        const remove = document.querySelector('.account-delete-button').getBoundingClientRect();
        const card = document.querySelector('.account-card').getBoundingClientRect();
        if (Math.abs(toggle.top - remove.top) > 1 || toggle.right > remove.left || card.height > 180) throw new Error('Card footer alignment failed');
    } else {
        document.querySelector('[title="Редагувати"]').click();
        await pause();
        if (mode === 'afp') {
            document.querySelector('[role="dialog"] .account-token-picker button:last-child').click();
            await pause();
        }
        const dialog = document.querySelector('[role="dialog"]');
        const rect = dialog.getBoundingClientRect();
        const heights = [...dialog.querySelectorAll('.field input')].map((input) => input.getBoundingClientRect().height);
        const modes = [...dialog.querySelectorAll('.account-proxy-modes label')].map((item) => item.getBoundingClientRect().top);
        if (rect.left < 0 || rect.right > innerWidth || rect.bottom > innerHeight || dialog.scrollWidth > dialog.clientWidth || heights.some((height) => height !== 40) || new Set(modes).size > 1) throw new Error(JSON.stringify({ rect: rect.toJSON(), viewport: [innerWidth, innerHeight], widths: [dialog.scrollWidth, dialog.clientWidth], heights, modes }));
    }
    const result = parent.document.createElement('p'); result.id = 'ui-check-result'; result.hidden = true; result.textContent = 'passed'; parent.document.body.append(result);
}
check().catch((error) => { parent.document.body.dataset.checkError = error.message; });`;

const server = await createServer({
    root: path.resolve("frontend"),
    server: { port: 0, strictPort: false, open: false },
    plugins: [{ name: "api-client-preview", enforce: "pre",
        resolveId(id) { if (id.endsWith("__api-client-preview.jsx")) return path.resolve("frontend/__api-client-preview.jsx"); },
        load(id) { if (id.endsWith("__api-client-preview.jsx")) return fixture; },
        configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
            if (req.url.split("?")[0] === "/__api-client-frame") {
                const params = new URL(req.url, "http://localhost").searchParams;
                res.setHeader("Content-Type", "text/html");
                res.end(`<html><body style="margin:0;background:#090b12"><iframe title="Preview" style="display:block;margin:auto;border:0;width:${Number(params.get("width"))}px;height:800px" src="/__api-client-preview?mode=${encodeURIComponent(params.get("mode"))}"></iframe></body></html>`);
            } else if (req.url.split("?")[0] === "/__api-client-preview") {
                res.setHeader("Content-Type", "text/html");
                res.end(await vite.transformIndexHtml(req.url, '<html><head><meta charset="utf-8" /><style>.account-card-shell,.account-editor { opacity: 1 !important; transform: none !important; }</style></head><body><div id="root"></div><script type="module" src="/__api-client-preview.jsx"></script></body></html>'));
            } else next();
        });
    } }],
});

try {
    await server.listen();
    const address = server.httpServer.address();
    const directory = path.resolve("artifacts/api-client-editor-check");
    await mkdir(directory, { recursive: true });
    let executablePath;
    for (const candidate of ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"]) {
        try { await access(candidate); executablePath = candidate; break; } catch {}
    }
    assert.ok(executablePath, "Не знайдено браузер для перевірки");
    for (const [width, mode] of [[1100, "access"], [390, "access"], [390, "afp"], [390, "card"]]) {
        const result = await promisify(execFile)(executablePath, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(directory, `cli-${Date.now()}`)}`, "--window-size=1200,1000", "--virtual-time-budget=4000", "--dump-dom", `--screenshot=${path.join(directory, `${mode}-${width}.png`)}`, `http://localhost:${address.port}/__api-client-frame?width=${width}&mode=${mode}`], { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024 });
        assert.ok(/id="ui-check-result"[^>]*>passed</.test(result.stdout), result.stdout.match(/data-check-error="([^"]*)"/)?.[1] || result.stdout.slice(-1800));
    }
    console.log("UI перевірено: 1100/390 px, поля по 40 px, проксі в один рядок, без горизонтального переповнення.");
} finally {
    await server.close();
}
