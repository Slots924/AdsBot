const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
app.setPath("userData", path.join(__dirname, "creatives-electron-test-profile"));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { preload: path.join(__dirname, "creatives-preview-preload.cjs"), contextIsolation: false, sandbox: false } });
    try {
        await win.loadURL("http://127.0.0.1:5175");
        const wait = async (condition) => {
            const deadline = Date.now() + 20000;
            while (!await win.webContents.executeJavaScript(condition)) {
                if (Date.now() > deadline) throw new Error(`Очікування: ${condition}`);
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        };
        await wait('Boolean(document.querySelector(".creative-list-item"))');
        await win.webContents.executeJavaScript('[...document.querySelectorAll(".creative-list-item")].find(button => button.textContent.startsWith("202")).click()');
        await wait('Boolean(document.querySelector(".creative-editor textarea"))');
        await new Promise((resolve) => setTimeout(resolve, 600));
        await mkdir(path.join(__dirname, "creatives-ui"), { recursive: true });
        await writeFile(path.join(__dirname, "creatives-ui/original.png"), (await win.webContents.capturePage()).toPNG());
        await win.webContents.executeJavaScript('[...document.querySelectorAll(".creative-versions button")].find(button => button.textContent === "UA").click()');
        await wait('document.querySelector(".creative-editor textarea")?.value.startsWith("Текст креативу для України")');
        await new Promise((resolve) => setTimeout(resolve, 300));
        await writeFile(path.join(__dirname, "creatives-ui/country.png"), (await win.webContents.capturePage()).toPNG());
        await writeFile(path.join(__dirname, "creatives-ui/checks.json"), JSON.stringify(await win.webContents.executeJavaScript('({flagsLoaded: [...document.querySelectorAll(".creative-versions img")].every(img=>img.complete && img.naturalWidth>0), pageOverflow: document.documentElement.scrollWidth>innerWidth, editorVisible: document.querySelector(".creative-editor footer button").getBoundingClientRect().bottom<=innerHeight})')));
        win.setSize(1100, 800);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await writeFile(path.join(__dirname, "creatives-ui/compact.png"), (await win.webContents.capturePage()).toPNG());
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    finally { win.destroy(); app.quit(); }
});
