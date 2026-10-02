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
    bmRequest: (payload) => ipcRenderer.invoke("bm:request", payload),
    onBMProgress: (callback) => subscribe("bm:progress", callback),
    getAccounts: () => ipcRenderer.invoke("accounts:list"),
    refreshAccounts: () => ipcRenderer.invoke("accounts:refresh"),
    createAccount: (account) => ipcRenderer.invoke("accounts:create", account),
    updateAccount: (accountKey, patch) =>
        ipcRenderer.invoke("accounts:update", { accountKey, ...patch }),
    setPrimaryAccount: (accountKey) => ipcRenderer.invoke("accounts:set-primary", { accountKey }),
    checkAccount: (accountKey) =>
        ipcRenderer.invoke("accounts:check", { accountKey }),
    syncAccountFromAdsPower: (accountKey, options = {}) =>
        ipcRenderer.invoke("accounts:sync-from-adspower", { accountKey, ...options }),
    openAccountAdsPowerProfile: (accountKey) =>
        ipcRenderer.invoke("accounts:adspower-open", { accountKey }),
    closeAccountAdsPowerProfile: (accountKey) =>
        ipcRenderer.invoke("accounts:adspower-close", { accountKey }),
    setAccountArchived: (accountKey, archived) =>
        ipcRenderer.invoke("accounts:archive-set", { accountKey, archived }),
    deleteAccount: (accountKey) =>
        ipcRenderer.invoke("accounts:delete", { accountKey }),
    getProxies: () => ipcRenderer.invoke("proxies:list"),
    syncProxyFromAdsPower: (proxyId) => ipcRenderer.invoke("proxies:sync-from-adspower", { proxyId }),
    getProxy: (proxyId) => ipcRenderer.invoke("proxies:get", { proxyId }),
    createProxy: (proxy) => ipcRenderer.invoke("proxies:create", proxy),
    updateProxy: (proxyId, patch) =>
        ipcRenderer.invoke("proxies:update", { proxyId, ...patch }),
    deleteProxy: (proxyId) => ipcRenderer.invoke("proxies:delete", { proxyId }),
    checkProxy: (proxyId) => ipcRenderer.invoke("proxies:check", { proxyId }),
    checkProxyConfig: (config) =>
        ipcRenderer.invoke("proxies:check-config", config),
    refreshProxyIp: (proxyId) =>
        ipcRenderer.invoke("proxies:refresh-ip", { proxyId }),
    reorderProxies: (orderedIds) =>
        ipcRenderer.invoke("proxies:reorder", { orderedIds }),
    getFanPages: (accountKey, force = false) =>
        ipcRenderer.invoke("pages:list", { accountKey, force }),
    loadClientWorkspace: (accountKey, force = false) =>
        ipcRenderer.invoke("workspace:client-load", { accountKey, force }),
    setPageFavorite: (pageId, isFavorite) =>
        ipcRenderer.invoke("pages:favorite-set", { pageId, isFavorite }),
    updatePageMetadata: (pageId, patch) =>
        ipcRenderer.invoke("pages:metadata-update", { pageId, ...patch }),
    getPagePostsWithLinks: (accountKey, pageId, force = false) =>
        ipcRenderer.invoke("pages:posts-with-links", {
            accountKey,
            pageId,
            force,
        }),
    getPagePostsSignature: (accountKey, pageId) =>
        ipcRenderer.invoke("pages:posts-signature", { accountKey, pageId }),
    refreshSelectedFanPage: (accountKey, pageId) =>
        ipcRenderer.invoke("pages:selected-refresh", { accountKey, pageId }),
    deletePagePosts: (options) =>
        ipcRenderer.invoke("pages:posts-delete", options),
    deletePagePost: (options) =>
        ipcRenderer.invoke("pages:post-delete", options),
    getPageRebuildRequirements: (accountKey, pageId) =>
        ipcRenderer.invoke("pages:rebuild-requirements", {
            accountKey,
            pageId,
        }),
    startPageRebuild: (options) =>
        ipcRenderer.invoke("pages:rebuild-start", options),
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
    setKeitaroLeadSync: (accountKey, adAccountId, enabled) =>
        ipcRenderer.invoke("ads:keitaro-lead-sync-set", {
            accountKey,
            adAccountId,
            enabled,
        }),
    getAdCampaigns: (accountKey, adAccountId, datePreset, force = false) =>
        ipcRenderer.invoke("campaigns:list", {
            accountKey,
            adAccountId,
            datePreset,
            force,
        }),
    refreshAdCampaignStatistics: (accountKey, adAccountId, datePreset) =>
        ipcRenderer.invoke("campaigns:statistics-refresh", {
            accountKey,
            adAccountId,
            datePreset,
        }),
    refreshAdCampaignData: (accountKey, adAccountId, datePreset) =>
        ipcRenderer.invoke("campaigns:refresh", {
            accountKey,
            adAccountId,
            datePreset,
        }),
    reorderAdCampaigns: (adAccountId, orderedIds) =>
        ipcRenderer.invoke("campaigns:reorder", { adAccountId, orderedIds }),
    setAdCampaignStatus: (accountKey, adAccountId, campaignId, status) =>
        ipcRenderer.invoke("campaigns:status-set", {
            accountKey,
            adAccountId,
            campaignId,
            status,
        }),
    deleteAdCampaign: (accountKey, adAccountId, campaignId) =>
        ipcRenderer.invoke("campaigns:delete", {
            accountKey,
            adAccountId,
            campaignId,
        }),
    renameAdCampaign: (accountKey, adAccountId, campaignId, name) =>
        ipcRenderer.invoke("campaigns:rename", {
            accountKey,
            adAccountId,
            campaignId,
            name,
        }),
    getCampaignPagePosts: (accountKey, pageId, limit = 10, force = false) =>
        ipcRenderer.invoke("campaigns:posts-list", {
            accountKey,
            pageId,
            limit,
            force,
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
    getAdsPowerGroupProfiles: (groupId) =>
        ipcRenderer.invoke("groups:profiles", { groupId }),
    moveAdsPowerProfiles: (profileIds, groupId) =>
        ipcRenderer.invoke("profiles:move", { profileIds, groupId }),
    renameAdsPowerProfile: (profileId, name) =>
        ipcRenderer.invoke("profiles:rename", { profileId, name }),
    publishCreativePost: (options) =>
        ipcRenderer.invoke("post:publish", options),
    runCommentingCampaign: (options) =>
        ipcRenderer.invoke("comments:run", options),
    runCommentAccountSetup: (options) =>
        ipcRenderer.invoke("account-setup:run", options),
    runCommentReactions: (options) =>
        ipcRenderer.invoke("comment-reactions:run", options),
    checkCommentAccounts: (options) =>
        ipcRenderer.invoke("comment-account-health:run", options),
    getCreditCards: () => ipcRenderer.invoke("credit-cards:list"),
    createCreditCard: (payload) => ipcRenderer.invoke("credit-cards:create", payload),
    updateCreditCard: (id, payload) => ipcRenderer.invoke("credit-cards:update", { id, ...payload }),
    deleteCreditCard: (id) => ipcRenderer.invoke("credit-cards:delete", { id }),
    startPersonalAccountSession: (profileNo) =>
        ipcRenderer.invoke("personal-account:start", { profileNo }),
    switchPersonalAccountProfile: (sessionId, profileNo) =>
        ipcRenderer.invoke("personal-account:switch-profile", { sessionId, profileNo }),
    startBusinessManagerSession: (accountKey, previousSessionId) =>
        ipcRenderer.invoke("business-manager:start", { accountKey, previousSessionId }),
    getBusinessManagerSession: (sessionId) =>
        ipcRenderer.invoke("business-manager:get", { sessionId }),
    getAvailableBusinessManagers: (sessionId) =>
        ipcRenderer.invoke("business-manager:available-list", { sessionId }),
    requestBusinessAdAccountAccess: (sessionId, businessId, adAccountId) =>
        ipcRenderer.invoke("business-manager:ad-account-request", { sessionId, businessId, adAccountId }),
    disconnectBusinessManagerSession: (sessionId) =>
        ipcRenderer.invoke("business-manager:disconnect", { sessionId }),
    closeBusinessManagerProfile: (sessionId) =>
        ipcRenderer.invoke("business-manager:profile-close", { sessionId }),
    getPersonalAccountSession: (sessionId) =>
        ipcRenderer.invoke("personal-account:get", { sessionId }),
    refreshPersonalAccountOverview: (sessionId) =>
        ipcRenderer.invoke("personal-account:overview-refresh", { sessionId }),
    getPersonalFanPages: (sessionId) =>
        ipcRenderer.invoke("personal-account:fanpage-list", { sessionId }),
    getPersonalSwitchableFacebookProfiles: (sessionId) =>
        ipcRenderer.invoke("personal-account:switchable-profiles-list", { sessionId }),
    createPersonalFanPage: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:fanpage-create", { sessionId, ...payload }),
    switchPersonalFanPage: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:fanpage-switch", { sessionId, ...payload }),
    grantPersonalFanPageAccess: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:fanpage-access-grant", { sessionId, ...payload }),
    getPersonalAdAccounts: (sessionId) =>
        ipcRenderer.invoke("personal-account:ad-accounts-list", { sessionId }),
    preparePersonalAdAccountAccess: (sessionId, adAccountId) =>
        ipcRenderer.invoke("personal-account:ad-access-prepare", { sessionId, adAccountId }),
    findPersonalAdAccountAccess: (sessionId, input) =>
        ipcRenderer.invoke("personal-account:ad-access-find", { sessionId, ...input }),
    listPersonalAdAccountAccess: (sessionId, adAccountId) =>
        ipcRenderer.invoke("personal-account:ad-access-list", { sessionId, adAccountId }),
    acceptPersonalAdAccountAccess: (sessionId, invite) =>
        ipcRenderer.invoke("personal-account:ad-access-accept", { sessionId, invite }),
    rejectPersonalAdAccountAccess: (sessionId, invite) =>
        ipcRenderer.invoke("personal-account:ad-access-reject", { sessionId, invite }),
    checkPersonalBusinessInfo: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:business-info-check", { sessionId, ...payload }),
    updatePersonalBusinessInfo: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:business-info-update", { sessionId, ...payload }),
    addPersonalCreditCard: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:card-add", { sessionId, ...payload }),
    requestPersonalPhoneCode: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:phone-request", { sessionId, ...payload }),
    submitPersonalPhoneCode: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:phone-submit", { sessionId, ...payload }),
    getPersonalSmsPoolDashboard: (sessionId = null) =>
        ipcRenderer.invoke("personal-account:sms-pool-dashboard", { sessionId }),
    getPersonalSmsPoolState: (sessionId) =>
        ipcRenderer.invoke("personal-account:sms-pool-state", { sessionId }),
    startPersonalSmsPoolVerification: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:sms-pool-start", { sessionId, ...payload }),
    resendPersonalSmsPoolVerification: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:sms-pool-resend", { sessionId, ...payload }),
    stopPersonalSmsPoolVerification: (sessionId) =>
        ipcRenderer.invoke("personal-account:sms-pool-stop", { sessionId }),
    getPersonalPixels: (sessionId, adAccountId) =>
        ipcRenderer.invoke("personal-account:pixels-list", { sessionId, adAccountId }),
    createPersonalPixel: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:pixel-create", { sessionId, ...payload }),
    createPersonalApiProfile: (sessionId, payload) =>
        ipcRenderer.invoke("personal-account:api-profile-create", { sessionId, ...payload }),
    disconnectPersonalAccountSession: (sessionId) =>
        ipcRenderer.invoke("personal-account:disconnect", { sessionId }),
    closePersonalAccountProfile: (sessionId) =>
        ipcRenderer.invoke("personal-account:profile-close", { sessionId }),
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
    resolveBackgroundTaskAction: (taskId, actionKey, payload) =>
        ipcRenderer.invoke("tasks:resolve-action", { taskId, actionKey, payload }),
    getLogs: (filters) => ipcRenderer.invoke("logs:list", filters),
    getProfileActivity: (filters) => ipcRenderer.invoke("profile-activity:list", filters),
    deleteProfileActivity: (profileNos) => ipcRenderer.invoke("profile-activity:delete", { profileNos }),
    getLogScopes: () => ipcRenderer.invoke("logs:scopes"),
    setLogLevel: (level) => ipcRenderer.invoke("logs:level-set", { level }),
    writeRendererLog: (entry) => ipcRenderer.invoke("logs:renderer-write", entry),
    getReports: (filters) => ipcRenderer.invoke("reports:list", filters),
    getReport: (reportId) => ipcRenderer.invoke("reports:get", { reportId }),
    deleteReport: (reportId) => ipcRenderer.invoke("reports:delete", { reportId }),
    exportReportMarkdown: (reportId) =>
        ipcRenderer.invoke("reports:export-markdown", { reportId }),
    getMarkdownReports: (filters) => ipcRenderer.invoke("reports:markdown-list", filters),
    getMarkdownReport: (reportId) =>
        ipcRenderer.invoke("reports:markdown-get", { reportId }),
    getTemplates: () => ipcRenderer.invoke("templates:list"),
    getCountries: () => ipcRenderer.invoke("countries:list"),
    getLanguages: () => ipcRenderer.invoke("languages:list"),
    createTemplate: (template) =>
        ipcRenderer.invoke("templates:create", template),
    updateTemplate: (id, template) =>
        ipcRenderer.invoke("templates:update", { id, ...template }),
    duplicateTemplate: (id) =>
        ipcRenderer.invoke("templates:duplicate", { id }),
    deleteTemplate: (id) =>
        ipcRenderer.invoke("templates:delete", { id }),
    getKeitaroCampaignGroups: () => ipcRenderer.invoke("keitaro:groups-list"),
    getKeitaroCampaignsReport: (options) =>
        ipcRenderer.invoke("keitaro:campaigns-report", options),
    getKeitaroCampaignsList: (options) =>
        ipcRenderer.invoke("keitaro:campaigns-list", options),
    getKeitaroCampaignStats: (options) =>
        ipcRenderer.invoke("keitaro:campaigns-stats", options),
    moveKeitaroCampaignsToGroup: (payload) =>
        ipcRenderer.invoke("keitaro:campaigns-move", payload),
    changeKeitaroCampaignPixels: (payload) =>
        ipcRenderer.invoke("keitaro:campaigns-pixel-change", payload),
    changeKeitaroCampaignDomains: (payload) =>
        ipcRenderer.invoke("keitaro:campaigns-domain-change", payload),
    getKeitaroLandingPages: (options) => ipcRenderer.invoke("keitaro:landing-pages-list", options),
    getKeitaroOffers: (options) => ipcRenderer.invoke("keitaro:offers-list", options),
    getKeitaroOffersReport: (options) => ipcRenderer.invoke("keitaro:offers-report", options),
    moveKeitaroOffersToGroup: (payload) => ipcRenderer.invoke("keitaro:offers-move", payload),
    getKeitaroAssetGroups: (kind) => ipcRenderer.invoke("keitaro:asset-groups-list", { kind }),
    getKeitaroCountries: () => ipcRenderer.invoke("keitaro:countries-list"),
    getKeitaroDomains: () => ipcRenderer.invoke("keitaro:domains-list"),
    getKeitaroTrafficSources: () => ipcRenderer.invoke("keitaro:traffic-sources-list"),
    createKeitaroCampaign: (payload) => ipcRenderer.invoke("keitaro:campaign-create", payload),
    getKeitaroStreamTemplates: () =>
        ipcRenderer.invoke("keitaro-stream-templates:list"),
    createKeitaroStreamTemplate: (payload) =>
        ipcRenderer.invoke("keitaro-stream-templates:create", payload),
    updateKeitaroStreamTemplate: (id, payload) =>
        ipcRenderer.invoke("keitaro-stream-templates:update", { id, ...payload }),
    duplicateKeitaroStreamTemplate: (id) =>
        ipcRenderer.invoke("keitaro-stream-templates:duplicate", { id }),
    deleteKeitaroStreamTemplate: (id) =>
        ipcRenderer.invoke("keitaro-stream-templates:delete", { id }),
    refreshKeitaroStreamTemplateOffers: () =>
        ipcRenderer.invoke("keitaro-stream-templates:offers-refresh"),
    applyKeitaroStreamTemplate: (payload) =>
        ipcRenderer.invoke("keitaro-stream-templates:apply", payload),
    applyKeitaroStreamTemplateToMatchingStreams: (templateId) =>
        ipcRenderer.invoke("keitaro-stream-templates:apply-to-matching-streams", { templateId }),
    getKeitaroCampaignSettings: () =>
        ipcRenderer.invoke("keitaro-campaign-settings:get"),
    saveKeitaroCampaignSettings: (payload) =>
        ipcRenderer.invoke("keitaro-campaign-settings:save", payload),
    getSpendOverview: () => ipcRenderer.invoke("spend:overview"),
    getSpendSettings: () => ipcRenderer.invoke("spend:settings-get"),
    saveSpendSettings: (payload) =>
        ipcRenderer.invoke("spend:settings-save", payload),
    startSpendCollection: () => ipcRenderer.invoke("spend:collect-start"),
    startSpendExport: () => ipcRenderer.invoke("spend:export-start"),
    loadAppState: () => ipcRenderer.invoke("state:load"),
    saveAppState: (state) => ipcRenderer.invoke("state:save", state),
    setUiScale: (scale) => ipcRenderer.invoke("app:set-zoom", { scale }),
    selectImage: () => ipcRenderer.invoke("dialog:select-image"),
    selectImages: () => ipcRenderer.invoke("dialog:select-images"),
    getImagePreview: (imagePath) => ipcRenderer.invoke("images:preview", { imagePath }),
    selectPageRebuildImages: () =>
        ipcRenderer.invoke("dialog:select-page-rebuild-images"),
    selectAccountPhotosFolder: (defaultPath) =>
        ipcRenderer.invoke("dialog:select-account-photos-folder", {
            defaultPath,
        }),
    openLocalPath: (filePath) =>
        ipcRenderer.invoke("app:open-path", { filePath }),
    openExternal: (url) => ipcRenderer.invoke("app:open-external", { url }),
    getDroppedFilePath: (file) => webUtils.getPathForFile(file),
    onLog: (callback) => subscribe("log:event", callback),
    onCampaignCreationProgress: (callback) =>
        subscribe("campaign-creation:progress", callback),
    onBackgroundTasksUpdated: (callback) =>
        subscribe("tasks:updated", callback),
    onWorkspaceRefreshed: (callback) =>
        subscribe("workspace:refreshed", callback),
    onAdsPowerStatesUpdated: (callback) =>
        subscribe("accounts:adspower-states", callback),
    onFacebookAccountStatusUpdated: (callback) =>
        subscribe("accounts:facebook-status", callback),
    onApiClientCreated: (callback) =>
        subscribe("accounts:api-client-created", callback),
    onCampaignsRefreshed: (callback) =>
        subscribe("campaigns:refreshed", callback),
    onKeitaroCampaignLeadsRefreshed: (callback) =>
        subscribe("campaigns:keitaro-leads-refreshed", callback),
    onCampaignsInvalidated: (callback) =>
        subscribe("campaigns:invalidated", callback),
    onPagePostsCacheUpdated: (callback) =>
        subscribe("pages:posts-cache-updated", callback),
    onCloseBlocked: (callback) => subscribe("app:close-blocked", callback),
});
