const {
    contextBridge,
    ipcRenderer,
    webUtils,
} = require("electron");


function subscribe(channel, callback) {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
}


contextBridge.exposeInMainWorld("adsBot", {
    getAccounts: () => ipcRenderer.invoke("accounts:list"),
    refreshAccounts: () => ipcRenderer.invoke("accounts:refresh"),
    getFanPages: (accountKey) =>
        ipcRenderer.invoke("pages:list", { accountKey }),
    getAdAccounts: (accountKey) =>
        ipcRenderer.invoke("ads:list", { accountKey }),
    renameAdAccount: (adAccountId, name) =>
        ipcRenderer.invoke("ads:rename", { adAccountId, name }),
    setAdAccountFavorite: (accountKey, adAccountId, isFavorite) =>
        ipcRenderer.invoke("ads:favorite-set", {
            accountKey,
            adAccountId,
            isFavorite,
        }),
    reorderFavoriteAdAccounts: (accountKey, orderedIds) =>
        ipcRenderer.invoke("ads:favorite-reorder", {
            accountKey,
            orderedIds,
        }),
    getAdCampaigns: (accountKey, adAccountId, datePreset) =>
        ipcRenderer.invoke("campaigns:list", {
            accountKey,
            adAccountId,
            datePreset,
        }),
    getCampaignPagePosts: (accountKey, pageId, limit = 10) =>
        ipcRenderer.invoke("campaigns:posts-list", {
            accountKey,
            pageId,
            limit,
        }),
    preflightCampaignCreation: (options) =>
        ipcRenderer.invoke("campaigns:create-preflight", options),
    startCampaignCreation: (options) =>
        ipcRenderer.invoke("campaigns:create-start", options),
    getCampaignCreationJob: (jobId) =>
        ipcRenderer.invoke("campaigns:create-job", { jobId }),
    retryCampaignCreation: (jobId) =>
        ipcRenderer.invoke("campaigns:create-retry", { jobId }),
    cleanupCampaignCreation: (jobId) =>
        ipcRenderer.invoke("campaigns:create-cleanup", { jobId }),
    getAdsPowerGroups: () => ipcRenderer.invoke("groups:list"),
    refreshAdsPowerGroups: () => ipcRenderer.invoke("groups:refresh"),
    publishCreativePost: (options) =>
        ipcRenderer.invoke("post:publish", options),
    runCommentingCampaign: (options) =>
        ipcRenderer.invoke("comments:run", options),
    getTemplates: () => ipcRenderer.invoke("templates:list"),
    getCountries: () => ipcRenderer.invoke("countries:list"),
    createTemplate: (template) =>
        ipcRenderer.invoke("templates:create", template),
    updateTemplate: (id, template) =>
        ipcRenderer.invoke("templates:update", { id, ...template }),
    duplicateTemplate: (id) =>
        ipcRenderer.invoke("templates:duplicate", { id }),
    deleteTemplate: (id) =>
        ipcRenderer.invoke("templates:delete", { id }),
    loadAppState: () => ipcRenderer.invoke("state:load"),
    saveAppState: (state) => ipcRenderer.invoke("state:save", state),
    setUiScale: (scale) => ipcRenderer.invoke("app:set-zoom", { scale }),
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    openExternal: (url) => ipcRenderer.invoke("app:open-external", { url }),
    getDroppedFilePath: (file) => webUtils.getPathForFile(file),
    onLog: (callback) => subscribe("log:event", callback),
    onCampaignCreationProgress: (callback) =>
        subscribe("campaign-creation:progress", callback),
    onCloseBlocked: (callback) => subscribe("app:close-blocked", callback),
});
