import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


const defaultState = {
    activeTab: "publish",
    uiScale: 1.3,
    createCampaignsPaused: true,
    selectedAccountKey: "",
    selectedPageId: "",
    selectedAdAccountId: "",
    selectedGroupIds: [],
    lastPublishedPost: null,
    publishForm: {
        geo: "",
        creativeName: "",
        siteUrl: "",
        imagePath: "",
    },
    commentsForm: {
        geo: "",
        creativeName: "",
        siteUrl: "",
        postUrl: "",
    },
};


function stringsFrom(source, fields) {
    return Object.fromEntries(fields.map((field) => [
        field,
        typeof source?.[field] === "string" ? source[field] : "",
    ]));
}


function normalizeState(state = {}) {
    const allowedTabs = new Set(["publish", "comments", "ads", "templates"]);
    const requestedScale = Number(state.uiScale);
    return {
        activeTab: allowedTabs.has(state.activeTab)
            ? state.activeTab
            : defaultState.activeTab,
        uiScale: Number.isFinite(requestedScale)
            ? Math.min(1.5, Math.max(0.8, requestedScale))
            : defaultState.uiScale,
        createCampaignsPaused: state.createCampaignsPaused !== false,
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
        publishForm: stringsFrom(state.publishForm, [
            "geo",
            "creativeName",
            "siteUrl",
            "imagePath",
        ]),
        commentsForm: stringsFrom(state.commentsForm, [
            "geo",
            "creativeName",
            "siteUrl",
            "postUrl",
        ]),
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
