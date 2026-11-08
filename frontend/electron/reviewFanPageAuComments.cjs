const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../../artifacts/fanpage-au-comments-design");
app.setPath("userData", path.join(output, "electron-preview"));
app.whenReady().then(async () => {
    await mkdir(output, { recursive: true });
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true,
        webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code);
    const settle = () => new Promise(resolve => setTimeout(resolve, 500));
    const click = text => run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    try {
        for (const [width, height] of [[1440, 1000], [1100, 800], [800, 700], [520, 800]]) {
            win.setContentSize(width, height);
            await win.loadURL(process.argv[2]); await settle();
            await click("AU Comments"); await settle();
            assert.equal(await run(`document.querySelector('[role="dialog"] h2').textContent`), "AU Comments");
            assert.equal(await run(`document.querySelector('[role="dialog"] input[type="url"]').value`), "https://www.facebook.com/permalink.php?story_fbid=123&id=456");
            assert.equal(await run(`!![...document.querySelectorAll('input')].find(i=>i.value==='202')`), true);
            await click("Завантажити акаунти та коментарі"); await settle();
            assert.equal(await run(`document.querySelectorAll('.au-profile input:checked').length`), 12);
            await run(`document.querySelector('.au-profile input').click()`); await settle();
            const geometry = await run(`(() => {const d=document.querySelector('[role="dialog"]');const r=d.getBoundingClientRect();return {fits:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,overflow:d.scrollWidth>d.clientWidth,comments:document.querySelectorAll('.au-comments li').length};})()`);
            assert.deepEqual(geometry, { fits: true, overflow: false, comments: 2 });
            if (width === 1440) assert.ok(await run(`document.querySelector('[role="dialog"]').getBoundingClientRect().width>=950`));
            await writeFile(path.join(output, `au-comments-${width}.png`), (await win.webContents.capturePage()).toPNG());
            await run(`document.querySelector('[role="dialog"]').scrollTop=10000`); await settle();
            assert.ok(await run(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Запустити AU'));const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&!b.disabled;})()`));
            await click("Запустити AU Comments"); await settle();
            assert.equal(await run(`window.submitted.ids.length`), 11);
            assert.equal(await run(`window.submitted.ids.includes('p0')`), false);
            assert.equal(await run(`document.body.dataset.queued`), "yes");
            console.log(`${width}×${height}: перехід, поля, вибір профілів, геометрія та запуск — OK`);
        }
    } finally { win.destroy(); }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
