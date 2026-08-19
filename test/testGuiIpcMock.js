import assert from "node:assert/strict";

import registerIpcHandlers
    from "../frontend/electron/registerIpcHandlers.js";


const handlers = new Map();
const openedUrls = [];
const zoomFactors = [];
const templateManager = {
    async list() {
        return [{ id: 1, name: "AT", pixel: "123" }];
    },
    async create(template) {
        return { id: 2, ...template };
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
    getWindow: () => ({
        isDestroyed: () => false,
        webContents: {
            setZoomFactor(scale) {
                zoomFactors.push(scale);
            },
        },
    }),
});

assert.deepEqual(
    await handlers.get("accounts:list")({}, {}),
    {
        ok: true,
        data: [{ accountKey: "fp_hub", status: "active" }],
    }
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

const failedPost = await handlers.get("post:publish")({}, {});
assert.equal(failedPost.ok, false);
assert.equal(failedPost.error.code, "FACEBOOK_API_ERROR");
assert.equal(failedPost.error.httpStatus, 400);
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
