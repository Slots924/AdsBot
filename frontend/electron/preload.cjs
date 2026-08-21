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
    createAccount: (account) => ipcRenderer.invoke("accounts:create", account),
    updateAccount: (accountKey, patch) =>
        ipcRenderer.invoke("accounts:update", { accountKey, ...patch }),
    setAccountArchived: (accountKey, archived) =>
        ipcRenderer.invoke("accounts:archive-set", { accountKey, archived }),
    getFanPages: (accountKey) =>
        ipcRenderer.invoke("pages:list", { accountKey }),
    loadClientWorkspace: (accountKey) =>
        ipcRenderer.invoke("workspace:client-load", { accountKey }),
    setPageFavorite: (pageId, isFavorite) =>
        ipcRenderer.invoke("pages:favorite-set", { pageId, isFavorite }),
    updatePageMetadata: (pageId, patch) =>
        ipcRenderer.invoke("pages:metadata-update", { pageId, ...patch }),
    getPagePostsWithLinks: (accountKey, pageId) =>
        ipcRenderer.invoke("pages:posts-with-links", { accountKey, pageId }),
    deletePagePosts: (options) =>
        ipcRenderer.invoke("pages:posts-delete", options),
    deletePagePost: (options) =>
        ipcRenderer.invoke("pages:post-delete", options),
    getAdAccounts: (accountKey) =>
        ipcRenderer.invoke("ads:list", { accountKey }),
    getAdPixels: (accountKey, adAccountId) =>
        ipcRenderer.invoke("ads:pixels-list", { accountKey, adAccountId }),
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
    startCreativeLaunch: (options) =>
        ipcRenderer.invoke("creative-launch:start", options),
    getCreativeLaunch: (workflowJobId) =>
        ipcRenderer.invoke("creative-launch:get", { workflowJobId }),
    retryCreativeLaunch: (workflowJobId, patch = {}) =>
        ipcRenderer.invoke("creative-launch:retry", { workflowJobId, patch }),
    getBackgroundTasks: () => ipcRenderer.invoke("tasks:list"),
    cancelBackgroundTask: (taskId) =>
        ipcRenderer.invoke("tasks:cancel", { taskId }),
    dismissBackgroundTask: (taskId) =>
        ipcRenderer.invoke("tasks:dismiss", { taskId }),
    clearFinishedBackgroundTasks: () =>
        ipcRenderer.invoke("tasks:clear-finished"),
    setCommentTaskConcurrency: (value) =>
        ipcRenderer.invoke("tasks:comment-concurrency-set", { value }),
    getLogs: (filters) => ipcRenderer.invoke("logs:list", filters),
    getLogScopes: () => ipcRenderer.invoke("logs:scopes"),
    setLogLevel: (level) => ipcRenderer.invoke("logs:level-set", { level }),
    writeRendererLog: (entry) => ipcRenderer.invoke("logs:renderer-write", entry),
    getReports: (filters) => ipcRenderer.invoke("reports:list", filters),
    getReport: (reportId) => ipcRenderer.invoke("reports:get", { reportId }),
    deleteReport: (reportId) => ipcRenderer.invoke("reports:delete", { reportId }),
    exportReportMarkdown: (reportId) =>
        ipcRenderer.invoke("reports:export-markdown", { reportId }),
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
    onBackgroundTasksUpdated: (callback) =>
        subscribe("tasks:updated", callback),
    onCloseBlocked: (callback) => subscribe("app:close-blocked", callback),
});
