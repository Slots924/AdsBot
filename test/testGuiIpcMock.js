import assert from "node:assert/strict";

import registerIpcHandlers
    from "../frontend/electron/registerIpcHandlers.js";


const handlers = new Map();
const openedUrls = [];
const zoomFactors = [];
const rendererEvents = [];
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
let storedJob = null;
const backgroundTasks = [];
const backgroundTaskManager = {
    async enqueue(options) {
        const task = {
            id: `task-${backgroundTasks.length + 1}`,
            type: options.type,
            name: options.name,
            status: "queued",
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
        async showOpenDialog() {
            return {
                canceled: false,
                filePaths: ["C:/images/post.jpg"],
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
    countryCatalog,
    campaignCreationJournal,
    backgroundTaskManager,
    facebookAccountManager,
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
assert.equal((await handlers.get("tasks:list")({}, {})).data.length, 1);
const commentingTask = await handlers.get("comments:run")({}, {
    groupIds: ["7"],
    geo: "HU",
    creativeName: "138",
    postUrl: "https://www.facebook.com/post",
});
assert.equal(commentingTask.ok, true);
assert.equal(commentingTask.data.task.type, "comments");
assert.equal(commentingTask.data.task.status, "queued");
assert.deepEqual(
    await handlers.get("tasks:comment-concurrency-set")({}, { value: 3 }),
    { ok: true, data: 3 }
);
assert.deepEqual(
    await handlers.get("pages:list")({}, { accountKey: "fp_hub" }),
    { ok: true, data: [] }
);
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

const failedPost = await handlers.get("post:publish")({}, {});
assert.equal(failedPost.ok, false);
assert.equal(failedPost.error.code, "FACEBOOK_API_ERROR");
assert.equal(failedPost.error.httpStatus, 400);
assert.equal(failedPost.error.graphUserTitle, "Invalid ad configuration");
assert.equal(
    failedPost.error.graphUserMessage,
    "The selected post is incompatible"
);
assert(!("secret" in failedPost.error));
assert(!("stack" in failedPost.error));

assert.deepEqual(
    await handlers.get("dialog:select-image")({}, {}),
    { ok: true, data: "C:/images/post.jpg" }
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
