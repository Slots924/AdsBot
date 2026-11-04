const { app, safeStorage } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
app.disableHardwareAcceleration();
app.setPath("userData", path.join(app.getPath("appData"), "Electron"));

// Перевіряє лише читання даних; не замовляє SMS, не створює активів і не змінює налаштувань.
app.whenReady().then(async () => {
    const root = path.resolve(__dirname, "../..");
    const load = file => import(pathToFileURL(path.join(root, file)).href);
    try {
        const profileNo = process.argv[2];
        if (!/^\d+$/.test(profileNo || "")) throw new Error("Вкажіть номер профілю");
        const { default: dotenv } = await load("node_modules/dotenv/lib/main.js");
        dotenv.config({ path: path.join(root, ".env"), quiet: true });
        const { default: AdsPower } = await load("classes/AdsPower.js");
        const { default: SessionStore } = await load("services/autoupload/AutouploadSessionStore.js");
        const { default: Manager } = await load("services/personalAccounts/PersonalAutouploadSessionManager.js");
        const { default: Reports } = await load("services/reports/TaskReportManager.js");
        const { default: secretStorage } = await load("frontend/electron/secretStorage.js");
        const manager = new Manager({ adsPower: new AdsPower(),
            sessionStore: new SessionStore({ directory: path.join(root, "data/autoupload/sessions"), ...secretStorage(safeStorage) }),
            reportManager: new Reports({ reportsDirectory: path.join(root, "data/reports/tasks") }),
        });
        console.log(JSON.stringify({ stage: "start", profileNo }));
        const session = await manager.start({ profileNo });
        const account = session.overview.adAccounts[0];
        console.log(JSON.stringify({ stage: "overview", accounts: session.overview.adAccounts.length, fanPages: session.overview.fanPages.length }));
        if (!account) return;
        for (const action of ["business.check", "phone.check", "pixels"]) {
            try {
                const result = await manager.execute(action, { sessionId: session.id, adAccountId: account.accountId || account.id });
                console.log(JSON.stringify({ action, success: true, count: Array.isArray(result) ? result.length : undefined,
                    phoneStatus: result.phoneStatus, hasCurrency: Boolean(result.currency), hasTimezone: Boolean(result.timezone) }));
            } catch (error) {
                console.log(JSON.stringify({ action, success: false, code: error.code, graphCode: error.graphCode, stage: error.stage }));
            }
        }
    } catch (error) {
        console.log(JSON.stringify({ stage: "failed", code: error.code, graphCode: error.graphCode }));
        process.exitCode = 1;
    } finally { app.quit(); }
});
