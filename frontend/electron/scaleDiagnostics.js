import os from "node:os";

import { app, BrowserWindow, screen } from "electron";


const allowedZoomFactors = new Set([1, 1.25, 1.3, 1.5]);
let diagnosticWindow = null;


function diagnosticHtml() {
    const fontSizes = [7, 8, 9, 10, 11, 12, 14, 16];
    const samples = fontSizes.map((size) => `
        <tr>
            <td><code>${size}px</code></td>
            <td><span class="font-sample" data-font-size="${size}" style="font-size:${size}px">AdsBot · Фанпейджі · Рекламна кампанія · 0123456789</span></td>
        </tr>
    `).join("");

    return `<!doctype html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
    <title>AdsBot · Діагностика масштабування</title>
    <style>
        :root { color: #f5f7ff; background: #090b12; font: 16px/1.45 "Segoe UI Variable", "Segoe UI", sans-serif; color-scheme: dark; }
        * { box-sizing: border-box; }
        body { margin: 0; padding: 28px; background: radial-gradient(circle at 80% 0, rgba(132,114,255,.16), transparent 35%), #090b12; }
        main { width: min(1120px, 100%); margin: 0 auto; }
        h1 { margin: 5px 0 8px; font-size: 30px; letter-spacing: -.035em; }
        h2 { margin: 0 0 14px; font-size: 17px; }
        p { margin: 0; color: #9ca3b7; }
        .eyebrow { color: #a99eff; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        .toolbar { display: flex; flex-wrap: wrap; gap: 9px; margin: 22px 0; }
        button { min-height: 42px; padding: 0 15px; border: 1px solid rgba(255,255,255,.11); border-radius: 10px; color: #dfe2ec; background: rgba(255,255,255,.055); font: 700 13px/1 "Segoe UI", sans-serif; cursor: pointer; }
        button:hover { border-color: rgba(132,114,255,.65); background: rgba(132,114,255,.14); }
        button.active { border-color: #9587ff; color: #fff; background: linear-gradient(135deg, #8472ff, #4f8cff); }
        button.copy { margin-left: auto; }
        .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
        section { min-width: 0; padding: 18px; border: 1px solid rgba(255,255,255,.09); border-radius: 14px; background: rgba(17,20,32,.88); }
        .full { grid-column: 1 / -1; }
        dl { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(0, 1.3fr); gap: 8px 15px; margin: 0; }
        dt { color: #7f879b; font-size: 12px; }
        dd { margin: 0; overflow-wrap: anywhere; color: #e5e7ef; font: 600 12px/1.45 "Cascadia Code", Consolas, monospace; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.07); text-align: left; vertical-align: middle; }
        th { color: #7f879b; font-size: 11px; text-transform: uppercase; }
        td:first-child { width: 72px; color: #b9b1ff; }
        .ruler { width: 100px; height: 18px; margin-top: 16px; border: 1px solid #a99eff; background: repeating-linear-gradient(90deg, rgba(132,114,255,.28) 0 1px, transparent 1px 10px); }
        .ruler-label { display: block; margin-top: 5px; color: #858da2; font-size: 11px; }
        .findings { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
        .finding { padding: 11px 13px; border: 1px solid rgba(246,189,88,.22); border-radius: 10px; color: #d9dce6; background: rgba(246,189,88,.065); font-size: 13px; }
        .finding.good { border-color: rgba(69,223,161,.22); background: rgba(69,223,161,.065); }
        .finding.warn { border-color: rgba(255,100,124,.28); background: rgba(255,100,124,.075); }
        pre { max-height: 270px; margin: 0; overflow: auto; padding: 14px; border-radius: 10px; color: #aeb6c9; background: #07090f; font: 11px/1.5 "Cascadia Code", Consolas, monospace; white-space: pre-wrap; }
        .copy-status { align-self: center; min-width: 120px; color: #62e6ad; font-size: 12px; }
        @media (max-width: 760px) { body { padding: 16px; } .grid { grid-template-columns: 1fr; } .full { grid-column: auto; } button.copy { margin-left: 0; } }
    </style>
</head>
<body>
    <main>
        <span class="eyebrow">AdsBot scale laboratory</span>
        <h1>Діагностика масштабування</h1>
        <p>Порівняйте текст при різному Electron zoom. Вікно не читає конфігурацію, акаунти або токени AdsBot.</p>
        <div class="toolbar">
            ${[100, 125, 130, 150].map((percentage) => `<button type="button" data-zoom="${percentage / 100}" onclick="requestZoom(${percentage / 100})">${percentage}%</button>`).join("")}
            <button type="button" class="copy" onclick="copyReport()">Копіювати звіт</button>
            <span class="copy-status" id="copy-status"></span>
        </div>
        <div class="grid">
            <section>
                <h2>Windows та монітор</h2>
                <dl id="display-metrics"></dl>
            </section>
            <section>
                <h2>Chromium та вікно</h2>
                <dl id="browser-metrics"></dl>
            </section>
            <section class="full">
                <h2>Контрольні розміри шрифтів</h2>
                <table><thead><tr><th>CSS</th><th>Однаковий текст</th></tr></thead><tbody>${samples}</tbody></table>
                <div class="ruler"></div><span class="ruler-label">Контрольна лінійка: 100 CSS px</span>
            </section>
            <section class="full">
                <h2>Автоматичні висновки</h2>
                <ul class="findings" id="findings"></ul>
            </section>
            <section class="full">
                <h2>Звіт без приватних даних</h2>
                <pre id="report"></pre>
            </section>
        </div>
    </main>
    <script>
        let mainMetrics = null;
        let report = null;

        const rows = (values) => Object.entries(values).map(([label, value]) => (
            '<dt>' + label + '</dt><dd>' + String(value) + '</dd>'
        )).join('');

        function browserMetrics() {
            const sampleSizes = Object.fromEntries(Array.from(document.querySelectorAll('.font-sample')).map((sample) => [
                sample.dataset.fontSize + 'px',
                getComputedStyle(sample).fontSize,
            ]));
            return {
                devicePixelRatio: window.devicePixelRatio,
                visualViewportScale: window.visualViewport?.scale ?? null,
                innerSizeCssPx: window.innerWidth + ' × ' + window.innerHeight,
                outerSizeDip: window.outerWidth + ' × ' + window.outerHeight,
                screenSizeDip: window.screen.width + ' × ' + window.screen.height,
                availableScreenDip: window.screen.availWidth + ' × ' + window.screen.availHeight,
                rootFontSize: getComputedStyle(document.documentElement).fontSize,
                bodyFontSize: getComputedStyle(document.body).fontSize,
                sampleComputedFontSizes: sampleSizes,
            };
        }

        function conclusions(main, browser) {
            const result = [];
            const expectedDpr = main.display.scaleFactor * main.window.zoomFactor;
            const dprMatches = Math.abs(browser.devicePixelRatio - expectedDpr) < 0.08;
            const zoomMatches = Math.abs(main.window.zoomFactor - main.window.requestedZoomFactor) < 0.01;
            if (main.display.scaleFactor === 1 && main.display.estimatedPhysicalSize.width >= 2400) {
                result.push({ level: 'warn', text: '2K/4K-монітор працює з Windows scale factor 100%. Фізично текст буде дрібнішим, ніж при системному масштабі 125–150%.' });
            } else {
                result.push({ level: 'good', text: 'Windows повідомляє scale factor ' + Math.round(main.display.scaleFactor * 100) + '%.' });
            }
            if (dprMatches) {
                result.push({ level: 'good', text: 'Chromium DPR узгоджується з Windows DPI та Electron zoom: масштабування рушія працює очікувано.' });
            } else {
                result.push({ level: 'warn', text: 'Chromium DPR не збігається з Windows scale factor × zoom. Перевірте Windows Compatibility → High DPI settings для Electron.' });
            }
            if (zoomMatches) {
                result.push({ level: 'good', text: 'Electron застосував вибраний zoom ' + Math.round(main.window.zoomFactor * 100) + '%.' });
            } else {
                result.push({ level: 'warn', text: 'Фактичний Electron zoom не відповідає натиснутому значенню.' });
            }
            result.push({
                level: main.window.zoomFactor >= 1.3 ? 'warn' : '',
                text: 'AdsBot містить багато базових шрифтів 7–11 CSS px. Якщо контрольні рядки залишаються дрібними на 130–150%, причина в типографіці CSS, а не в DPI.',
            });
            return result;
        }

        function render() {
            if (!mainMetrics) return;
            const browser = browserMetrics();
            const findings = conclusions(mainMetrics, browser);
            document.getElementById('display-metrics').innerHTML = rows({
                'Монітор': mainMetrics.display.label,
                'Розмір у DIP': mainMetrics.display.size.width + ' × ' + mainMetrics.display.size.height,
                'Робоча область у DIP': mainMetrics.display.workAreaSize.width + ' × ' + mainMetrics.display.workAreaSize.height,
                'Windows scale factor': mainMetrics.display.scaleFactor + ' (' + Math.round(mainMetrics.display.scaleFactor * 100) + '%)',
                'Оцінка фізичних px': mainMetrics.display.estimatedPhysicalSize.width + ' × ' + mainMetrics.display.estimatedPhysicalSize.height,
                'Windows': mainMetrics.runtime.windows,
                'Electron / Chromium': mainMetrics.runtime.electron + ' / ' + mainMetrics.runtime.chromium,
            });
            document.getElementById('browser-metrics').innerHTML = rows({
                'devicePixelRatio': browser.devicePixelRatio,
                'visualViewport.scale': browser.visualViewportScale,
                'Electron zoom': mainMetrics.window.zoomFactor + ' (' + Math.round(mainMetrics.window.zoomFactor * 100) + '%)',
                'Вікно у DIP': mainMetrics.window.bounds.width + ' × ' + mainMetrics.window.bounds.height,
                'Внутрішня область CSS px': browser.innerSizeCssPx,
                'screen у DIP': browser.screenSizeDip,
                'Root / body font': browser.rootFontSize + ' / ' + browser.bodyFontSize,
            });
            document.querySelectorAll('[data-zoom]').forEach((button) => button.classList.toggle(
                'active',
                Math.abs(Number(button.dataset.zoom) - mainMetrics.window.zoomFactor) < .01
            ));
            document.getElementById('findings').innerHTML = findings.map((finding) => (
                '<li class="finding ' + finding.level + '">' + finding.text + '</li>'
            )).join('');
            report = {
                generatedAt: new Date().toISOString(),
                runtime: mainMetrics.runtime,
                display: mainMetrics.display,
                window: mainMetrics.window,
                browser,
                conclusions: findings.map((finding) => finding.text),
            };
            document.getElementById('report').textContent = JSON.stringify(report, null, 2);
        }

        window.applyMainMetrics = (metrics) => {
            mainMetrics = metrics;
            requestAnimationFrame(render);
        };
        window.requestZoom = (zoom) => {
            window.location.href = 'adsbot-scale://zoom/' + zoom;
        };
        window.copyReport = async () => {
            const text = JSON.stringify(report, null, 2);
            const status = document.getElementById('copy-status');
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                textarea.remove();
            }
            status.textContent = 'Звіт скопійовано';
            setTimeout(() => { status.textContent = ''; }, 2200);
        };
        window.addEventListener('resize', () => requestAnimationFrame(render));
    </script>
</body>
</html>`;
}


function collectMainMetrics(requestedZoomFactor) {
    const display = screen.getDisplayMatching(diagnosticWindow.getBounds());
    const zoomFactor = diagnosticWindow.webContents.getZoomFactor();
    return {
        runtime: {
            platform: process.platform,
            windows: `${os.release()} (${os.arch()})`,
            electron: process.versions.electron,
            chromium: process.versions.chrome,
        },
        display: {
            id: display.id,
            label: display.label || `Display ${display.id}`,
            size: display.size,
            workAreaSize: display.workAreaSize,
            scaleFactor: display.scaleFactor,
            rotation: display.rotation,
            estimatedPhysicalSize: {
                width: Math.round(display.size.width * display.scaleFactor),
                height: Math.round(display.size.height * display.scaleFactor),
            },
        },
        window: {
            bounds: diagnosticWindow.getBounds(),
            zoomFactor,
            requestedZoomFactor,
        },
    };
}


async function publishMetrics(requestedZoomFactor) {
    if (!diagnosticWindow || diagnosticWindow.isDestroyed()) return;
    const metrics = collectMainMetrics(requestedZoomFactor);
    await diagnosticWindow.webContents.executeJavaScript(
        `window.applyMainMetrics(${JSON.stringify(metrics)})`
    );
}


async function createDiagnosticWindow() {
    let requestedZoomFactor = 1;
    diagnosticWindow = new BrowserWindow({
        width: 1180,
        height: 860,
        minWidth: 780,
        minHeight: 620,
        title: "AdsBot · Діагностика масштабування",
        backgroundColor: "#090b12",
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    diagnosticWindow.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("adsbot-scale://zoom/")) {
            if (!url.startsWith("data:text/html")) event.preventDefault();
            return;
        }
        event.preventDefault();
        const candidate = Number(url.slice("adsbot-scale://zoom/".length).replace(/\/$/, ""));
        if (!allowedZoomFactors.has(candidate)) return;
        requestedZoomFactor = candidate;
        diagnosticWindow.webContents.setZoomFactor(candidate);
        setTimeout(() => publishMetrics(requestedZoomFactor), 80);
    });
    diagnosticWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    diagnosticWindow.webContents.once("did-finish-load", async () => {
        diagnosticWindow.webContents.setZoomFactor(requestedZoomFactor);
        await publishMetrics(requestedZoomFactor);
        diagnosticWindow.show();
    });
    diagnosticWindow.on("move", () => publishMetrics(requestedZoomFactor));
    diagnosticWindow.on("closed", () => {
        diagnosticWindow = null;
        app.quit();
    });

    await diagnosticWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(diagnosticHtml())}`
    );
}


app.whenReady().then(createDiagnosticWindow).catch((error) => {
    console.error("Не вдалося запустити діагностику масштабування:", error);
    app.exit(1);
});

app.on("window-all-closed", () => app.quit());
