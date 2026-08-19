import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { config as loadEnv } from "dotenv";

import CreativeManager
    from "../../services/creatives/CreativeManager.js";
import AdsBotGuiService
    from "../../services/gui/AdsBotGuiService.js";
import AppStateStore from "../../services/gui/AppStateStore.js";
import AdAccountPreferencesStore
    from "../../services/gui/AdAccountPreferencesStore.js";
import CampaignTemplateManager
    from "../../services/templates/CampaignTemplateManager.js";
import CountryCatalog from "../../services/templates/CountryCatalog.js";
import CampaignCreationJournal
    from "../../services/campaigns/CampaignCreationJournal.js";
import { appPaths } from "./paths.js";
import registerIpcHandlers from "./registerIpcHandlers.js";


loadEnv({ path: appPaths.env });

const isDevelopment = process.argv.includes("--dev");
let mainWindow = null;
let guiService = null;
let templateManager = null;
let appStateStore = null;
let adAccountPreferencesStore = null;
let countryCatalog = null;
let campaignCreationJournal = null;


function sendRendererEvent(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
    }
}


function createLogger() {
    const send = (level, message) => {
        sendRendererEvent("log:event", {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
            level,
            scope: "backend",
            message: String(message),
        });
    };

    return {
        info: (message) => send("info", message),
        warn: (message) => send("warn", message),
        error: (message) => send("error", message),
    };
}


async function createWindow() {
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

    const createCreativeManager = () => new CreativeManager({
        countriesFile: appPaths.countries,
        creativesDirectory: appPaths.creatives,
        systemPromptFile: appPaths.prompt,
    });

    guiService = await AdsBotGuiService.create({
        facebookBackendOptions: {
            facebookApiClientsOptions: {
                accountsFilePath: appPaths.accounts,
                proxiesFilePath: appPaths.proxies,
            },
            creativeManagerFactory: createCreativeManager,
        },
        groupsFile: appPaths.groups,
        reportsDirectory: appPaths.reports,
        creativeManagerFactory: createCreativeManager,
        logger: createLogger(),
    });
    templateManager = new CampaignTemplateManager({
        templatesFile: appPaths.templates,
    });
    countryCatalog = new CountryCatalog({
        countriesFile: appPaths.countries,
    });
    campaignCreationJournal = new CampaignCreationJournal({
        jobsFile: appPaths.campaignCreationJobs,
    });
    appStateStore = new AppStateStore({ stateFile: appPaths.appState });
    adAccountPreferencesStore = new AdAccountPreferencesStore({
        preferencesFile: appPaths.adAccountPreferences,
    });

    registerIpcHandlers({
        ipcMain,
        dialog,
        shell,
        guiService,
        templateManager,
        appStateStore,
        adAccountPreferencesStore,
        countryCatalog,
        campaignCreationJournal,
        getWindow: () => mainWindow,
    });

    mainWindow.on("close", (event) => {
        if (guiService?.isCommentingCampaignRunning) {
            event.preventDefault();
            sendRendererEvent("app:close-blocked", {
                message: "Дочекайтеся завершення кампанії коментування",
            });
        }
    });

    if (isDevelopment) {
        await mainWindow.loadURL("http://127.0.0.1:5173");
    } else {
        await mainWindow.loadFile(appPaths.renderer);
    }
}


app.whenReady().then(createWindow).catch((error) => {
    dialog.showErrorBox("Не вдалося запустити AdsBot GUI", error.message);
    app.quit();
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
