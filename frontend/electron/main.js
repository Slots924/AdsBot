import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { pathToFileURL } from "node:url";

import CreativeManager
    from "../../services/creatives/CreativeManager.js";
import AdsBotGuiService
    from "../../services/gui/AdsBotGuiService.js";
import AppStateStore from "../../services/gui/AppStateStore.js";
import AdAccountPreferencesStore
    from "../../services/gui/AdAccountPreferencesStore.js";
import PagePreferencesStore from "../../services/gui/PagePreferencesStore.js";
import RemoteDataCacheStore from "../../services/gui/RemoteDataCacheStore.js";
import CreativeLaunchJournal from "../../services/workflows/CreativeLaunchJournal.js";
import PageRebuildJournal from "../../services/workflows/PageRebuildJournal.js";
import CampaignTemplateManager
    from "../../services/templates/CampaignTemplateManager.js";
import CountryCatalog from "../../services/templates/CountryCatalog.js";
import LanguageCatalog from "../../services/templates/LanguageCatalog.js";
import CampaignCreationJournal
    from "../../services/campaigns/CampaignCreationJournal.js";
import BackgroundTaskJournal
    from "../../services/tasks/BackgroundTaskJournal.js";
import BackgroundTaskManager
    from "../../services/tasks/BackgroundTaskManager.js";
import AppLogger from "../../services/logging/AppLogger.js";
import TaskReportManager from "../../services/reports/TaskReportManager.js";
import { configureRuntimeLogger } from "../../services/logging/runtimeLogger.js";
import FacebookAccountManager
    from "../../facebook/accounts/FacebookAccountManager.js";
import ProxyManager from "../../services/proxy/ProxyManager.js";
import KeitaroGuiService from "../../services/keitaro/KeitaroGuiService.js";
import KeitaroStreamTemplateManager from "../../services/keitaro/KeitaroStreamTemplateManager.js";
import { appPaths } from "./paths.js";
import registerIpcHandlers from "./registerIpcHandlers.js";


loadEnv({ path: appPaths.env });

protocol.registerSchemesAsPrivileged([{
    scheme: "adsbot-cache",
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
    },
}]);

const isDevelopment = process.argv.includes("--dev");
let mainWindow = null;
let guiService = null;
let templateManager = null;
let appStateStore = null;
let adAccountPreferencesStore = null;
let pagePreferencesStore = null;
let remoteDataCacheStore = null;
let creativeLaunchJournal = null;
let countryCatalog = null;
let languageCatalog = null;
let campaignCreationJournal = null;
let facebookAccountManager = null;
let backgroundTaskManager = null;
let appLogger = null;
let taskReportManager = null;
let closeApproved = false;
let closePromptOpen = false;
let cacheProtocolReady = false;


function sendRendererEvent(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}


async function createWindow() {
    if (!cacheProtocolReady) protocol.handle("adsbot-cache", async (request) => {
        try {
            const requested = new URL(request.url);
            const filename = decodeURIComponent(requested.pathname).replace(/^\//, "");
            if (
                requested.hostname !== "image"
                || !/^[a-f0-9]{64}\.(?:jpg|png|webp)$/.test(filename)
                || path.basename(filename) !== filename
            ) {
                return new Response("Not found", { status: 404 });
            }
            const imagesRoot = path.resolve(appPaths.remoteImages);
            const imagePath = path.resolve(imagesRoot, filename);
            if (path.dirname(imagePath) !== imagesRoot) {
                return new Response("Not found", { status: 404 });
            }
            return await net.fetch(pathToFileURL(imagePath).toString());
        } catch {
            return new Response("Not found", { status: 404 });
        }
    });
    cacheProtocolReady = true;

    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1080,
        minHeight: 700,
        backgroundColor: "#090b12",
        title: "AdsBot Control Center",
        show: false,
        webPreferences: {
            preload: appPaths.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) => {
        const allowed = isDevelopment
            && url.startsWith("http://127.0.0.1:5173");

        if (!allowed) {
            event.preventDefault();
        }
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        appLogger?.error("renderer.gone", "Renderer-process завершився", details);
    });

    appStateStore = new AppStateStore({ stateFile: appPaths.appState });
    const restoredState = await appStateStore.load();
    appLogger = new AppLogger({
        logsDirectory: appPaths.logs,
        level: restoredState.logLevel,
    });
    appLogger.subscribe((event) => sendRendererEvent("log:event", event));
    await appLogger.initialize();
    configureRuntimeLogger(appLogger);
    appLogger.installConsoleBridge("legacy");
    taskReportManager = new TaskReportManager({
        reportsDirectory: appPaths.taskReports,
    });

    const createCreativeManager = () => new CreativeManager({
        countriesFile: appPaths.countries,
        creativesDirectory: appPaths.creatives,
        systemPromptFile: appPaths.prompt,
    });

    facebookAccountManager = new FacebookAccountManager({
        accountsFile: appPaths.accounts,
    });
    const proxyManager = new ProxyManager({
        proxiesFile: appPaths.proxies,
    });
    guiService = await AdsBotGuiService.create({
        facebookBackendOptions: {
            facebookApiClientsOptions: {
                accountsFilePath: appPaths.accounts,
                proxiesFilePath: appPaths.proxies,
            },
            creativeManagerFactory: createCreativeManager,
            pageRebuildJournal: new PageRebuildJournal({
                jobsFile: appPaths.pageRebuildJobs,
            }),
        },
        groupsFile: appPaths.groups,
        reportsDirectory: appPaths.reports,
        creativeManagerFactory: createCreativeManager,
        logger: appLogger.child("gui"),
    });
    templateManager = new CampaignTemplateManager({
        templatesFile: appPaths.templates,
    });
    countryCatalog = new CountryCatalog({
        countriesFile: appPaths.countries,
    });
    languageCatalog = new LanguageCatalog();
    campaignCreationJournal = new CampaignCreationJournal({
        jobsFile: appPaths.campaignCreationJobs,
    });
    backgroundTaskManager = new BackgroundTaskManager({
        journal: new BackgroundTaskJournal({
            tasksFile: appPaths.backgroundTasks,
        }),
        commentConcurrency: 1,
        logger: appLogger.child("tasks"),
        reportManager: taskReportManager,
    });
    await backgroundTaskManager.initialize();
    backgroundTaskManager.subscribe((payload) => {
        sendRendererEvent("tasks:updated", payload);
    });
    adAccountPreferencesStore = new AdAccountPreferencesStore({
        preferencesFile: appPaths.adAccountPreferences,
    });
    pagePreferencesStore = new PagePreferencesStore({ preferencesFile: appPaths.pagePreferences });
    remoteDataCacheStore = new RemoteDataCacheStore({
        cacheFile: appPaths.remoteDataCache,
        imagesDirectory: appPaths.remoteImages,
    });
    creativeLaunchJournal = new CreativeLaunchJournal({ jobsFile: appPaths.creativeLaunchJobs });

    const keitaroGuiService = new KeitaroGuiService({ countryCatalog });
    keitaroGuiService.setConcurrency(restoredState.keitaroConcurrency);
    const keitaroStreamTemplateManager = new KeitaroStreamTemplateManager({
        templatesFile: appPaths.keitaroStreamTemplates,
    });
    await keitaroStreamTemplateManager.list();

    registerIpcHandlers({
        ipcMain,
        dialog,
        shell,
        guiService,
        keitaroGuiService,
        keitaroStreamTemplateManager,
        templateManager,
        appStateStore,
        adAccountPreferencesStore,
        pagePreferencesStore,
        remoteDataCacheStore,
        creativeLaunchJournal,
        countryCatalog,
        languageCatalog,
        campaignCreationJournal,
        backgroundTaskManager,
        facebookAccountManager,
        proxyManager,
        logger: appLogger,
        reportManager: taskReportManager,
        getWindow: () => mainWindow,
    });

    mainWindow.on("close", async (event) => {
        if (closeApproved) return;
        event.preventDefault();
        if (closePromptOpen) return;
        closePromptOpen = true;
        if (!await backgroundTaskManager.hasUnfinished()) {
            closePromptOpen = false;
            await appLogger.flush();
            closeApproved = true;
            mainWindow.close();
            return;
        }
        const answer = await dialog.showMessageBox(mainWindow, {
            type: "warning",
            buttons: [
                "Залишити програму відкритою",
                "Зупинити задачі й вийти",
            ],
            defaultId: 0,
            cancelId: 0,
            title: "Є незавершені задачі",
            message: "Активні задачі буде зупинено після поточного безпечного етапу.",
            detail: "Уже прийнята Meta дія може завершитися. Відомі Graph ID залишаться у журналі.",
        });
        closePromptOpen = false;
        if (answer.response !== 1) return;

        sendRendererEvent("app:close-blocked", {
            message: "Безпечно зупиняємо активні задачі…",
        });
        await backgroundTaskManager.shutdown();
        await appLogger.flush();
        closeApproved = true;
        mainWindow.close();
    });

    if (isDevelopment) {
        await mainWindow.loadURL("http://127.0.0.1:5173");
    } else {
        await mainWindow.loadFile(appPaths.renderer);
    }
}


app.whenReady().then(createWindow).catch((error) => {
    appLogger?.error("app.start.failed", "Не вдалося запустити AdsBot GUI", { error });
    dialog.showErrorBox("Не вдалося запустити AdsBot GUI", error.message);
    app.quit();
});

process.on("unhandledRejection", (error) => {
    appLogger?.error("process.unhandled_rejection", "Необроблена Promise-помилка", { error });
});

process.on("uncaughtException", (error) => {
    appLogger?.error("process.uncaught_exception", "Необроблена помилка process", { error });
    Promise.resolve(appLogger?.flush()).finally(() => app.quit());
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
