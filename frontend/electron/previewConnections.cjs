const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

// Власне приховане вікно Electron відкриває лише демонстраційні дані без IPC та робочих API.
const output = path.resolve(__dirname, "../../artifacts/connections-design");
app.setPath("userData", path.join(output, "electron-preview"));
app.whenReady().then(async () => {
    await mkdir(output, { recursive: true });
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true, webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    const run = (code) => win.webContents.executeJavaScript(code);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 600));
    const screenshot = async (name) => writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    try {
        for (const [width, height] of [[1440, 1000], [1100, 800], [800, 700]]) {
            win.setContentSize(width, height);
            await win.loadURL("http://127.0.0.1:5178/?connections-ui");
            await settle();
            const geometry = await run(`(() => {
                const panels = [...document.querySelectorAll('.accounts-workspace > .sidebar')].map(el => ({ width: el.clientWidth, height: el.clientHeight }));
                const lists = [...document.querySelectorAll('.accounts-workspace .account-list')];
                lists[0].scrollTop = 100;
                const independent = lists[0].scrollTop === 100 && lists[1].scrollTop === 0;
                lists[0].scrollTop = 0;
                return { panels, independent, overflow: document.documentElement.scrollWidth > innerWidth, ids: [...document.querySelectorAll('.connection-facebook-id')].every(el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis') };
            })()`);
            assert.equal(geometry.panels.length, 2);
            assert.deepEqual(geometry.panels[0], geometry.panels[1]);
            assert.ok(geometry.independent && geometry.ids && !geometry.overflow, JSON.stringify(geometry));
            await screenshot(`connections-${width}`);
            for (const [selector, name] of [[".accounts-tab-sidebar:not(.connection-proxies) .strip-add-button", "client"], [".connection-proxies .strip-add-button", "proxy"]]) {
                await run(`document.querySelector(${JSON.stringify(selector)}).click()`);
                await settle();
                assert.ok(await run(`(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth; })()`), `${name} ${width}`);
                await screenshot(`${name}-${width}`);
                await run(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
                await settle();
            }
            console.log(`${width}×${height}: симетрія, незалежний скрол, повні ID та розміри редакторів — OK`);
        }
        win.setContentSize(1440, 1000);
        await win.loadURL("http://127.0.0.1:5178/?connections-ui");
        await settle();
        for (const kind of ["api", "bm", "system"]) {
            await run(`document.querySelector('.accounts-workspace .account-kind-option.${kind} input').click()`);
            await settle();
            const expected = { api: 6, bm: 8, system: 3 }[kind];
            assert.equal(await run(`document.querySelectorAll('.accounts-workspace .account-card-tools button').length`), kind === "api" ? expected * 7 : expected);
            await run(`document.querySelector('.accounts-workspace .account-card-tools button[title="Редагувати"]').click()`);
            await settle();
            assert.equal(await run(`document.querySelector('[role="dialog"]').getAttribute('aria-label')`), "Редагувати клієнта");
            await screenshot(`edit-${kind}`);
            await run(`document.querySelector('[role="dialog"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
            await settle();
        }
        await run(`document.querySelector('.connection-proxies button[title="Редагувати"]').click()`);
        await settle();
        assert.equal(await run(`document.querySelector('[role="dialog"]').getAttribute('aria-label')`), "Змінити проксі");
        await screenshot('edit-proxy');
        console.log('API, BM, System Users: усі кнопки присутні; редактори клієнтів і проксі відкриваються — OK');
    } finally { win.destroy(); }
}).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });
