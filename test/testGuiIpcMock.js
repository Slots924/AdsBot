import assert from "node:assert/strict";

import registerIpcHandlers
    from "../frontend/electron/registerIpcHandlers.js";


const handlers = new Map();
const openedUrls = [];
const zoomFactors = [];
const rendererEvents = [];
const logger = {
    list: async () => ({ items: [], nextCursor: null }),
    scopes: async () => ["gui"],
    setLevel: (level) => level === "debug" ? "debug" : "info",
    child: () => ({ info: () => ({ id: "log-1" }), warn() {}, error() {}, debug() {} }),
};
const reportManager = {
    list: async () => [{ id: "report-1", title: "Report" }],
    get: async () => ({ id: "report-1", title: "Report" }),
    delete: async (id) => id,
    exportMarkdown: async (_id, file) => file,
};
const templateManager = {
    async list() {
        return [{ id: 1, name: "AT", pixel: "123" }];
    },
    async create(template) {
        return { id: 2, ...template };
    },
    async get(id) {
        return { id, name: "AT", pixel: "123", countryCodes: ["HU"] };
    },
    async update(id, template) {
        return { id, ...template };
    },
    async duplicate(id) {
        return { id: id + 1, name: "AT", pixel: "123" };
    },
    async delete(id) {
        return { id };
    },
};
const appStateStore = {
    async load() {
        return { activeTab: "templates" };
    },
    async save(state) {
        return state;
    },
};
const adAccountPreferencesStore = {
    async enrichAccounts(accountKey, accounts) {
        assert.equal(accountKey, "fp_hub");
        return accounts.map((account) => ({
            ...account,
            localName: "Ім’я 1",
            isFavorite: false,
            favoritePosition: null,
        }));
    },
    async rename(adAccountId, name) {
        return { adAccountId, localName: name };
    },
    async setFavorite(_accountKey, adAccountId, isFavorite) {
        return isFavorite ? [adAccountId] : [];
    },
    async reorderFavorites(_accountKey, orderedIds) {
        return orderedIds;
    },
};
const pagePreferencesStore = {
    async enrich(pages) { return pages; },
    async setFavorite(pageId, isFavorite) { return { pageId, isFavorite }; },
    async updateMetadata(pageId, patch) { return { pageId, ...patch }; },
};
const remoteDataCacheStore = {
    async getWorkspace() { return null; },
    async setWorkspace() {},
    async setWorkspacePart() {},
    async getPosts() { return null; },
    async setPosts() {},
    async clearPosts() {},
    async removePosts() {},
    async prependPost() {},
    async getCampaigns() { return null; },
    async setCampaigns() {},
    async invalidateCampaigns() {},
};
const creativeLaunchJournal = {
    async create(draft) { return { id: "workflow-1", draft, subtasks: [] }; },
    async get() { return null; },
};
const countryCatalog = {
    async list() {
        return [{ code: "HU", name: "Hungary" }];
    },
};
const facebookAccountManager = {
    async list() {
        return [{
            accountKey: "fp_hub",
            name: "",
            facebookUserId: "",
            archived: false,
            hasUserAgent: true,
            hasAccessToken: true,
            hasCookie: true,
        }];
    },
    async create() {},
    async update() {},
    async setArchived() {},
};
const proxyManager = {
    async list() {
        return [{
            id: "proxy-001",
            adsPowerId: 14,
            name: "Київ",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            hasUsername: true,
            hasPassword: true,
            hasRefreshUrl: true,
        }];
    },
    async create() {},
    async update() {},
    async remove() {},
    async reorder() {
        return this.list();
    },
    async getById() {
        return {
            id: "proxy-001",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            refreshUrl: "https://provider.example/changeip/token",
        };
    },
};
let storedJob = null;
const backgroundTasks = [];
const enqueuedOptions = [];
const backgroundTaskManager = {
    async enqueue(options) {
        enqueuedOptions.push(options);
        const task = {
            id: `task-${backgroundTasks.length + 1}`,
            type: options.type,
            name: options.name,
            status: "queued",
            input: options.input ?? {},
            metadata: options.metadata ?? {},
            progress: { stage: "queued", completed: 0, total: 0 },
        };
        backgroundTasks.unshift(task);
        return structuredClone(task);
    },
    async list() {
        return structuredClone(backgroundTasks);
    },
    async cancel(id) {
        return { id, status: "cancelled" };
    },
    async dismiss(id) {
        return id;
    },
    async clearFinished() {
        return 0;
    },
    async setCommentConcurrency(value) {
        return Number(value);
    },
};
const campaignCreationJournal = {
    async create(input) {
        storedJob = {
            id: "job-1",
            input,
            status: "running",
            stage: "preflight",
            completed: 0,
            total: 5,
            objects: { campaignId: null, creativeId: null, adSets: [], ads: [] },
            errors: [],
        };
        return structuredClone(storedJob);
    },
    async get() {
        return storedJob ? structuredClone(storedJob) : null;
    },
    async update(_id, patch) {
        storedJob = { ...storedJob, ...patch };
        return structuredClone(storedJob);
    },
};
const ipcMain = {
    handle(channel, handler) {
        handlers.set(channel, handler);
    },
};
const guiService = {
    async getAccounts() {
        return [{ accountKey: "fp_hub", status: "active" }];
    },
    async refreshAccounts() {
        return [];
    },
    async getFanPages(accountKey) {
        assert.equal(accountKey, "fp_hub");
        return [];
    },
    async getFanPageList(accountKey) {
        assert.equal(accountKey, "fp_hub");
        return [];
    },
    async getFanPageDetails({ pageId }) {
        return { id: pageId, name: "Page", pictureUrl: null };
    },
    async getPagePostsSignature() {
        return { count: 0, postIds: [] };
    },
    async getPageRebuildRequirements({ accountKey, pageId }) {
        return {
            pageId,
            accountKey,
            pageCreatedAt: null,
            requiresPageCreatedAt: true,
        };
    },
    async rebuildPageFromFolder(options, onProgress) {
        await onProgress({
            stage: "complete",
            completed: 5,
            total: 5,
            message: "done",
        });
        return {
            pageId: options.pageId,
            warnings: [],
            publications: [{ postId: "10_post" }],
        };
    },
    async getAdAccounts() {
        return [{ id: "act_1", name: "Meta" }];
    },
    async getAdCampaigns(accountKey, adAccountId, datePreset) {
        return { accountKey, adAccountId, datePreset, campaigns: [] };
    },
    async getPagePosts({ accountKey, pageId, limit }) {
        assert.equal(accountKey, "fp_hub");
        assert.equal(limit, 10);
        return [{ id: `${pageId}_20`, message: "Safe" }];
    },
    async preflightLeadCampaign(options) {
        return { adAccountId: options.adAccountId, currency: "USD" };
    },
    async createLeadCampaign(options, onProgress) {
        const objects = {
            campaignId: "campaign-1",
            creativeId: "creative-1",
            adSets: [{ index: 0, id: "adset-1" }],
            ads: [{ index: 0, id: "ad-1" }],
        };
        await onProgress({ stage: "complete", objects });
        return { objects };
    },
    async getAdsPowerGroups() {
        return [];
    },
    async refreshAdsPowerGroups() {
        return [];
    },
    async publishCreativePost() {
        const error = new Error("Invalid request");
        error.code = "FACEBOOK_API_ERROR";
        error.httpStatus = 400;
        error.graphUserTitle = "Invalid ad configuration";
        error.graphUserMessage = "The selected post is incompatible";
        error.secret = "MUST_NOT_LEAK";
        throw error;
    },
    async runCommentingCampaign() {
        return { published: 1 };
    },
};

registerIpcHandlers({
    ipcMain,
    dialog: {
        async showOpenDialog(_window, options) {
            return {
                canceled: false,
                filePaths: options.properties.includes("openDirectory")
                    ? ["C:/images/page"]
                    : ["C:/images/post.jpg"],
            };
        },
    },
    shell: {
        async openExternal(url) {
            openedUrls.push(url);
        },
    },
    guiService,
    templateManager,
    appStateStore,
    adAccountPreferencesStore,
    pagePreferencesStore,
    remoteDataCacheStore,
    creativeLaunchJournal,
    countryCatalog,
    campaignCreationJournal,
    backgroundTaskManager,
    facebookAccountManager,
    proxyManager,
    checkProxyFn: async () => ({ working: true, ip: "203.0.113.10" }),
    refreshProxyIpFn: async () => ({
        working: true,
        timedOut: false,
        ip: "203.0.113.10",
    }),
    logger,
    reportManager,
    getWindow: () => ({
        isDestroyed: () => false,
        webContents: {
            setZoomFactor(scale) {
                zoomFactors.push(scale);
            },
            send(channel, payload) {
                rendererEvents.push({ channel, payload });
            },
        },
    }),
});

assert.deepEqual(
    await handlers.get("proxies:list")({}, {}),
    {
        ok: true,
        data: [{
            id: "proxy-001",
            adsPowerId: 14,
            name: "Київ",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            hasUsername: true,
            hasPassword: true,
            hasRefreshUrl: true,
        }],
    }
);
assert.deepEqual(
    await handlers.get("proxies:check-config")({}, {
        type: "socks5",
        host: "proxy.example.com",
        port: "10000",
        username: "demo-user",
        password: "demo-pass",
    }),
    {
        ok: true,
        data: {
            working: true,
            ip: "203.0.113.10",
            error: null,
        },
    }
);
assert.deepEqual(
    await handlers.get("proxies:check")({}, { proxyId: "proxy-001" }),
    {
        ok: true,
        data: {
            proxyId: "proxy-001",
            working: true,
            ip: "203.0.113.10",
            error: null,
        },
    }
);
assert.deepEqual(
    await handlers.get("accounts:list")({}, {}),
    {
        ok: true,
        data: [{
            accountKey: "fp_hub",
            name: "",
            facebookUserId: "",
            archived: false,
            hasUserAgent: true,
            hasAccessToken: true,
            hasCookie: true,
            status: "active",
        }],
    }
);
assert.deepEqual(
    await handlers.get("countries:list")({}, {}),
    { ok: true, data: [{ code: "HU", name: "Hungary" }] }
);
assert.deepEqual(
    await handlers.get("campaigns:create-preflight")({}, {
        accountKey: "fp_hub",
        adAccountId: "act_1",
        templateId: 1,
    }),
    { ok: true, data: { adAccountId: "act_1", currency: "USD" } }
);
const createdCampaign = await handlers.get("campaigns:create-start")({}, {
    accountKey: "fp_hub",
    adAccountId: "act_1",
    templateId: 1,
    campaignName: "Test",
    pageId: "10",
    postId: "20",
    adSetCount: 1,
    dailyBudget: 5,
    startTime: "2026-08-20T10:00:00.000Z",
    createPaused: true,
});
assert.equal(createdCampaign.ok, true);
assert.equal(createdCampaign.data.jobId, "job-1");
assert.equal(createdCampaign.data.task.status, "queued");
assert.equal(createdCampaign.data.task.metadata.campaignJobId, "job-1");
await campaignCreationJournal.update("job-1", {
    status: "failed",
    errors: [{ code: "FACEBOOK_API_ERROR" }],
    objects: {
        campaignId: "campaign-1",
        creativeId: null,
        adSets: [],
        ads: [],
    },
});
const retriedCampaign = await handlers.get("campaigns:create-retry")({}, {
    jobId: "job-1",
});
assert.equal(retriedCampaign.ok, true);
assert.equal(retriedCampaign.data.jobId, "job-1");
assert.equal(retriedCampaign.data.task.name, "Test · повтор");
assert.equal(retriedCampaign.data.task.metadata.campaignJobId, "job-1");
assert.equal(storedJob.status, "queued");
assert.deepEqual(storedJob.errors, []);
assert.equal(storedJob.objects.campaignId, "campaign-1");
assert.equal((await handlers.get("tasks:list")({}, {})).data.length, 2);
const commentingTask = await handlers.get("comments:run")({}, {
    groupIds: ["7"],
    geo: "HU",
    creativeName: "138",
    postUrl: "https://www.facebook.com/post",
    browserMode: "headless",
    disableImages: true,
});
assert.equal(commentingTask.ok, true);
assert.equal(commentingTask.data.task.type, "comments");
assert.equal(commentingTask.data.task.status, "queued");
assert.equal(commentingTask.data.task.input.browserMode, "headless");
assert.equal(commentingTask.data.task.input.disableImages, true);
assert.equal(commentingTask.data.task.metadata.browserMode, "headless");
assert.equal(commentingTask.data.task.metadata.disableImages, true);
assert.equal(JSON.stringify(commentingTask.data.task).includes("accessToken"), false);
assert.deepEqual(
    await handlers.get("tasks:comment-concurrency-set")({}, { value: 3 }),
    { ok: true, data: 3 }
);
assert.deepEqual(
    await handlers.get("pages:list")({}, { accountKey: "fp_hub" }),
    { ok: true, data: [] }
);
assert.deepEqual(
    await handlers.get("pages:rebuild-requirements")({}, {
        accountKey: "fp_hub",
        pageId: "10",
    }),
    {
        ok: true,
        data: {
            accountKey: "fp_hub",
            pageId: "10",
            pageCreatedAt: null,
            requiresPageCreatedAt: true,
        },
    }
);
const rebuildTask = await handlers.get("pages:rebuild-start")({}, {
    accountKey: "fp_hub",
    pageId: "10",
    imagesDirectory: "C:/images/page",
    pageCreatedAt: "2024-01-01",
});
assert.equal(rebuildTask.ok, true);
assert.equal(rebuildTask.data.task.type, "page-rebuild");
assert.equal(rebuildTask.data.task.metadata.pageId, "10");
assert.equal(
    enqueuedOptions.find((item) => item.type === "page-rebuild")
        .resources[0].key,
    "facebook-page:fp_hub:10"
);
const rebuildOutput = await enqueuedOptions
    .find((item) => item.type === "page-rebuild")
    .runner({
        signal: new AbortController().signal,
        progress: async () => {},
    });
assert.equal(rebuildOutput.result.publications[0].postId, "10_post");
assert.deepEqual(
    await handlers.get("ads:list")({}, { accountKey: "fp_hub" }),
    {
        ok: true,
        data: [{
            id: "act_1",
            name: "Meta",
            localName: "Ім’я 1",
            isFavorite: false,
            favoritePosition: null,
        }],
    }
);
assert.deepEqual(
    await handlers.get("ads:favorite-set")({}, {
        accountKey: "fp_hub",
        adAccountId: "act_1",
        isFavorite: true,
    }),
    { ok: true, data: ["act_1"] }
);
assert.deepEqual(
    await handlers.get("campaigns:list")({}, {
        accountKey: "fp_hub",
        adAccountId: "act_1",
        datePreset: "today",
    }),
    {
        ok: true,
        data: {
            accountKey: "fp_hub",
            adAccountId: "act_1",
            datePreset: "today",
            campaigns: [],
        },
    }
);
const listedPosts = await handlers.get("campaigns:posts-list")({}, {
    accountKey: "fp_hub",
    pageId: "10",
    limit: 10,
});
assert.equal(listedPosts.ok, true);
assert.equal(listedPosts.data[0].id, "10_20");
assert(!("pageAccessToken" in listedPosts.data[0]));

const queuedPost = await handlers.get("post:publish")({}, {
    accountKey: "fp_hub",
    pageId: "10",
    geo: "HU",
    creativeName: "138",
    siteUrl: "https://example.com",
});
assert.equal(queuedPost.ok, true);
assert.equal(queuedPost.data.task.type, "publication");
assert.equal(queuedPost.data.task.status, "queued");
assert.equal(queuedPost.data.task.input.creativeName, "138");
await assert.rejects(
    enqueuedOptions.find((item) => item.type === "publication").runner({
        signal: new AbortController().signal,
        progress: async () => {},
    }),
    { code: "FACEBOOK_API_ERROR" }
);
assert.equal((await handlers.get("logs:list")({}, {})).ok, true);
assert.equal((await handlers.get("reports:list")({}, {})).data[0].id, "report-1");

assert.deepEqual(
    await handlers.get("dialog:select-image")({}, {}),
    { ok: true, data: "C:/images/post.jpg" }
);
assert.deepEqual(
    await handlers.get("dialog:select-page-rebuild-folder")({}, {}),
    { ok: true, data: "C:/images/page" }
);
assert.equal(
    (await handlers.get("app:open-external")({}, {
        url: "https://www.facebook.com/post",
    })).ok,
    true
);
assert.deepEqual(openedUrls, ["https://www.facebook.com/post"]);
assert.deepEqual(
    await handlers.get("templates:list")({}, {}),
    { ok: true, data: [{ id: 1, name: "AT", pixel: "123" }] }
);
assert.deepEqual(
    await handlers.get("templates:create")({}, { name: "HU", pixel: "456" }),
    { ok: true, data: { id: 2, name: "HU", pixel: "456" } }
);
assert.deepEqual(
    await handlers.get("state:save")({}, { activeTab: "comments" }),
    { ok: true, data: { activeTab: "comments" } }
);
assert.deepEqual(
    await handlers.get("app:set-zoom")({}, { scale: 1.3 }),
    { ok: true, data: 1.3 }
);
assert.deepEqual(
    await handlers.get("app:set-zoom")({}, { scale: 2 }),
    { ok: true, data: 1.5 }
);
assert.deepEqual(zoomFactors, [1.3, 1.5]);
assert.equal(
    (await handlers.get("app:open-external")({}, {
        url: "https://example.com",
    })).error.code,
    "EXTERNAL_URL_NOT_ALLOWED"
);

console.log("Mock-перевірка GUI IPC пройшла успішно");
