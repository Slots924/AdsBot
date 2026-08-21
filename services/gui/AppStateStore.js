import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


const defaultState = {
    activeTab: "accounts",
    adsSubtab: "accounts",
    uiScale: 1.3,
    createCampaignsPaused: true,
    commentWorkerConcurrency: 5,
    commentBrowserMode: "visible",
    commentDisableImages: false,
    logLevel: "info",
    defaultPixelId: "",
    defaultUtm: "",
    taskPanelCollapsed: false,
    selectedAccountKey: "",
    selectedPageId: "",
    selectedAdAccountId: "",
    selectedGroupIds: [],
    lastPublishedPost: null,
};


function stringsFrom(source, fields) {
    return Object.fromEntries(fields.map((field) => [
        field,
        typeof source?.[field] === "string" ? source[field] : "",
    ]));
}


function normalizeState(state = {}) {
    const legacyTab = ["publish", "comments"].includes(state.activeTab) ? "pages" : state.activeTab;
    const allowedTabs = new Set(["accounts", "ads", "pages", "journal"]);
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
        commentBrowserMode: allowedCommentBrowserModes.has(state.commentBrowserMode)
            ? state.commentBrowserMode
            : defaultState.commentBrowserMode,
        commentDisableImages: state.commentDisableImages === true,
        logLevel: state.logLevel === "debug" ? "debug" : "info",
        defaultPixelId: String(state.defaultPixelId ?? "").trim(),
        defaultUtm: String(state.defaultUtm ?? ""),
        taskPanelCollapsed: Boolean(state.taskPanelCollapsed),
        ...stringsFrom(state, [
            "selectedAccountKey",
            "selectedPageId",
            "selectedAdAccountId",
        ]),
        selectedGroupIds: Array.isArray(state.selectedGroupIds)
            ? state.selectedGroupIds.filter((id) => typeof id === "string")
            : [],
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


export { defaultState, normalizeState };
