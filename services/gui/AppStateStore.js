import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


const defaultState = {
    activeTab: "accounts",
    adsSubtab: "accounts",
    uiScale: 1.3,
    createCampaignsPaused: true,
    commentWorkerConcurrency: 5,
    commentWorkerProxyIds: {},
    commentBrowserMode: "visible",
    commentDisableImages: false,
    accountSetupWorkerConcurrency: 5,
    accountSetupWorkerProxyIds: {},
    accountSetupBrowserMode: "visible",
    logLevel: "info",
    defaultPixelId: "",
    defaultUtm: "",
    taskPanelCollapsed: false,
    selectedAccountKey: "",
    selectedPageId: "",
    selectedAdAccountId: "",
    selectedGroupIds: [],
    favoriteGroupIds: [],
    commentLeftGroupId: "",
    commentRightGroupId: "",
    commentLeftSort: { column: "profileNo", direction: "asc" },
    commentRightSort: { column: "profileNo", direction: "asc" },
    commentLeftSelectedIds: [],
    commentRightSelectedIds: [],
    lastPublishedPost: null,
};


function stringsFrom(source, fields) {
    return Object.fromEntries(fields.map((field) => [
        field,
        typeof source?.[field] === "string" ? source[field] : "",
    ]));
}


function normalizeIdList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(
        value.map((id) => String(id ?? "").trim()).filter(Boolean)
    )];
}


function normalizeProfileSort(value, fallback) {
    const allowed = new Set(["profileNo", "name", "tags"]);
    return {
        column: allowed.has(value?.column) ? value.column : fallback.column,
        direction: value?.direction === "desc" ? "desc" : "asc",
    };
}


function normalizeCommentWorkerProxyIds(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (let worker = 1; worker <= 5; worker += 1) {
        const proxyId = String(value[worker] ?? value[String(worker)] ?? "").trim();
        if (proxyId) result[String(worker)] = proxyId;
    }
    return result;
}


function normalizeState(state = {}) {
    const legacyTab = ["publish", "comments"].includes(state.activeTab) ? "pages" : state.activeTab;
    const allowedTabs = new Set([
        "accounts",
        "ads",
        "pages",
        "comment-accounts",
        "journal",
    ]);
    const allowedCommentBrowserModes = new Set(["visible", "headless"]);
    const requestedScale = Number(state.uiScale);
    return {
        activeTab: allowedTabs.has(legacyTab)
            ? legacyTab
            : defaultState.activeTab,
        adsSubtab: state.adsSubtab === "templates" ? "templates" : "accounts",
        uiScale: Number.isFinite(requestedScale)
            ? Math.min(1.5, Math.max(0.8, requestedScale))
            : defaultState.uiScale,
        createCampaignsPaused: state.createCampaignsPaused !== false,
        commentWorkerConcurrency: Number.isFinite(Number(state.commentWorkerConcurrency))
            ? Math.min(5, Math.max(1, Math.round(Number(state.commentWorkerConcurrency))))
            : defaultState.commentWorkerConcurrency,
        commentWorkerProxyIds: normalizeCommentWorkerProxyIds(state.commentWorkerProxyIds),
        commentBrowserMode: allowedCommentBrowserModes.has(state.commentBrowserMode)
            ? state.commentBrowserMode
            : defaultState.commentBrowserMode,
        commentDisableImages: state.commentDisableImages === true,
        accountSetupWorkerConcurrency: Number.isFinite(Number(state.accountSetupWorkerConcurrency))
            ? Math.min(5, Math.max(1, Math.round(Number(state.accountSetupWorkerConcurrency))))
            : defaultState.accountSetupWorkerConcurrency,
        accountSetupWorkerProxyIds: normalizeCommentWorkerProxyIds(
            state.accountSetupWorkerProxyIds
        ),
        accountSetupBrowserMode: allowedCommentBrowserModes.has(
            state.accountSetupBrowserMode
        )
            ? state.accountSetupBrowserMode
            : defaultState.accountSetupBrowserMode,
        logLevel: state.logLevel === "debug" ? "debug" : "info",
        defaultPixelId: String(state.defaultPixelId ?? "").trim(),
        defaultUtm: String(state.defaultUtm ?? ""),
        taskPanelCollapsed: Boolean(state.taskPanelCollapsed),
        ...stringsFrom(state, [
            "selectedAccountKey",
            "selectedPageId",
            "selectedAdAccountId",
            "commentLeftGroupId",
            "commentRightGroupId",
        ]),
        selectedGroupIds: Array.isArray(state.selectedGroupIds)
            ? state.selectedGroupIds.filter((id) => typeof id === "string")
            : [],
        favoriteGroupIds: normalizeIdList(state.favoriteGroupIds),
        commentLeftSort: normalizeProfileSort(
            state.commentLeftSort,
            defaultState.commentLeftSort
        ),
        commentRightSort: normalizeProfileSort(
            state.commentRightSort,
            defaultState.commentRightSort
        ),
        commentLeftSelectedIds: normalizeIdList(state.commentLeftSelectedIds),
        commentRightSelectedIds: normalizeIdList(state.commentRightSelectedIds),
        lastPublishedPost: (
            typeof state.lastPublishedPost?.accountKey === "string"
            && typeof state.lastPublishedPost?.pageId === "string"
            && typeof state.lastPublishedPost?.postId === "string"
            && state.lastPublishedPost.postId
        ) ? stringsFrom(state.lastPublishedPost, [
            "accountKey",
            "pageId",
            "postId",
        ]) : null,
    };
}


export default class AppStateStore {
    #operation = Promise.resolve();


    constructor({ stateFile = "./data/app-state.json" } = {}) {
        this.stateFile = stateFile;
    }


    async load() {
        try {
            return normalizeState(JSON.parse(
                await readFile(this.stateFile, "utf8")
            ));
        } catch (error) {
            if (error.code === "ENOENT" || error instanceof SyntaxError) {
                return normalizeState();
            }
            throw error;
        }
    }


    save(state) {
        const normalized = normalizeState(state);
        const operation = this.#operation.then(async () => {
            await mkdir(path.dirname(this.stateFile), { recursive: true });
            const temporaryFile = `${this.stateFile}.tmp`;
            await writeFile(
                temporaryFile,
                `${JSON.stringify(normalized, null, 2)}\n`,
                "utf8"
            );
            await rename(temporaryFile, this.stateFile);
            return normalized;
        });
        this.#operation = operation.catch(() => {});
        return operation;
    }
}


export { defaultState, normalizeCommentWorkerProxyIds, normalizeState };
