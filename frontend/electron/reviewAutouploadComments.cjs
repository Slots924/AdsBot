const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../../artifacts/autoupload-comments-design");
app.setPath("userData", path.join(output, "electron-preview"));
app.whenReady().then(async () => {
    await mkdir(output, { recursive: true });
    const win = new BrowserWindow({ show: false, width: 1440, height: 1000, useContentSize: true,
        webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code);
    const settle = () => new Promise(resolve => setTimeout(resolve, 450));
    const screenshot = async name => writeFile(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
    try {
        for (const [width, height] of [[1440, 1000], [1100, 800], [800, 700], [520, 800]]) {
            win.setContentSize(width, height);
            await win.loadURL(process.argv[2]); await settle();
            await run(`document.querySelector('input[aria-label="Вибрати всі видимі профілі"]').click()`); await settle();
            await run(`document.querySelector('[aria-controls="autoupload-actions-list"]').click()`); await settle();
            await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Написати коментарі').click()`); await settle();
            assert.equal(await run(`document.querySelector('[role="dialog"] h2').textContent`), "Написати коментарі");
            if (width === 1440) await screenshot("comments-empty");
            await run(`(() => { const url=document.querySelector('[role="dialog"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(url,'https://www.facebook.com/permalink.php?story_fbid=pfbidDemo123&id=123');url.dispatchEvent(new Event('input',{bubbles:true})); const text=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(text,'Гарне фото! Дуже атмосферно.\\nДякую, що поділилися цим моментом.\\nЧудовий краєвид, хочеться побачити наживо.\\nНеймовірне світло на цьому фото.');text.dispatchEvent(new Event('input',{bubbles:true})); })()`); await settle();
            const geometry = await run(`(() => {const d=document.querySelector('[role="dialog"]');const r=d.getBoundingClientRect();return {fits:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,overflow:d.scrollWidth>d.clientWidth,count:document.querySelectorAll('.comment-compose-preview li').length,enabled:![...d.querySelectorAll('button')].find(b=>b.textContent.includes('Запустити чергу')).disabled};})()`);
            assert.deepEqual(geometry, { fits: true, overflow: false, count: 4, enabled: true });
            await screenshot(`comments-${width}`);
            await run(`document.querySelector('[role="dialog"]').scrollTop=10000`); await settle();
            assert.ok(await run(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Запустити чергу'));const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()`));
            await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Запустити чергу')).click()`); await settle();
            assert.equal(await run(`window.submitted.ids.length`), 6);
            assert.equal(await run(`document.querySelector('[role="dialog"]')===null`), true);
            console.log(`${width}×${height}: форма, черга, відсутність переповнення та запуск — OK`);
        }
    } finally { win.destroy(); }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
