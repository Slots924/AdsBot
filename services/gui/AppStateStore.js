import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
    defaultKeitaroColumnWidths,
    defaultKeitaroConcurrency,
    defaultKeitaroPageSize,
    defaultKeitaroVisibleColumns,
    keitaroColumnIds,
    keitaroConcurrencyMax,
    keitaroConcurrencyMin,
    keitaroDatePresets,
    keitaroPageSizes,
} from "../keitaro/reportColumns.js";


const defaultState = {
    activeTab: "accounts",
    adsSubtab: "accounts",
    uiScale: 1.3,
    createCampaignsPaused: true,
    createAdSetsPaused: true,
    createAdsPaused: true,
    commentWorkerConcurrency: 5,
    commentWorkerProxyIds: {},
    commentBrowserMode: "visible",
    commentDisableImages: false,
    accountSetupWorkerConcurrency: 5,
    accountSetupWorkerProxyIds: {},
    accountSetupBrowserMode: "visible",
    apiClientsBrowserMode: "visible",
    apiClientsDisableImages: false,
    accountSetupPhotosDirectory: "",
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
    lastPublishedPost: null,
    keitaroAvailableGroupIds: [],
    keitaroSearch: "",
    keitaroGroupId: "all",
    keitaroDatePreset: "today",
    keitaroSort: { column: "clicks", direction: "desc" },
    keitaroColumnOrder: [...keitaroColumnIds],
    keitaroColumnWidths: { ...defaultKeitaroColumnWidths },
    keitaroVisibleColumns: [...defaultKeitaroVisibleColumns],
    keitaroPageSize: defaultKeitaroPageSize,
    keitaroConcurrency: defaultKeitaroConcurrency,
    keitaroSubtab: "campaigns",
    keitaroOffersGrouped: false,
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


const keitaroColumnIdSet = new Set(keitaroColumnIds);
const keitaroDatePresetSet = new Set(keitaroDatePresets);
const keitaroPageSizeSet = new Set(keitaroPageSizes);


function normalizeKeitaroSort(value) {
    return {
        column: keitaroColumnIdSet.has(value?.column)
            ? value.column
            : defaultState.keitaroSort.column,
        direction: value?.direction === "asc" ? "asc" : "desc",
    };
}


function normalizeKeitaroColumnOrder(value) {
    const requested = Array.isArray(value)
        ? value.map((id) => String(id ?? "").trim()).filter((id) => keitaroColumnIdSet.has(id))
        : [];
    const unique = [...new Set(requested)];
    return [
        ...unique,
        ...keitaroColumnIds.filter((id) => !unique.includes(id)),
    ];
}


function normalizeKeitaroColumnWidths(value) {
    const widths = { ...defaultKeitaroColumnWidths };
    if (!value || typeof value !== "object" || Array.isArray(value)) return widths;
    for (const id of keitaroColumnIds) {
        const width = Number(value[id]);
        if (Number.isFinite(width)) {
            widths[id] = Math.min(640, Math.max(64, Math.round(width)));
        }
    }
    return widths;
}


function normalizeKeitaroVisibleColumns(value) {
    const requested = Array.isArray(value)
        ? [...new Set(
            value.map((id) => String(id ?? "").trim()).filter((id) => keitaroColumnIdSet.has(id))
        )]
        : [];
    return requested.length > 0 ? requested : [...defaultKeitaroVisibleColumns];
}


function normalizeState(state = {}) {
    const legacyTab = ["publish", "comments"].includes(state.activeTab) ? "pages" : state.activeTab;
    const allowedTabs = new Set([
        "accounts",
        "ads",
        "pages",
        "comment-accounts",
        "keitaro",
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
        createAdSetsPaused: state.createAdSetsPaused !== false,
        createAdsPaused: state.createAdsPaused !== false,
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
        apiClientsBrowserMode: allowedCommentBrowserModes.has(
            state.apiClientsBrowserMode
        ) ? state.apiClientsBrowserMode : defaultState.apiClientsBrowserMode,
        apiClientsDisableImages: state.apiClientsDisableImages === true,
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
            "accountSetupPhotosDirectory",
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
        keitaroAvailableGroupIds: normalizeIdList(state.keitaroAvailableGroupIds),
        keitaroSearch: String(state.keitaroSearch ?? ""),
        keitaroGroupId: String(state.keitaroGroupId ?? "").trim() || "all",
        keitaroDatePreset: keitaroDatePresetSet.has(state.keitaroDatePreset)
            ? state.keitaroDatePreset
            : defaultState.keitaroDatePreset,
        keitaroSort: normalizeKeitaroSort(state.keitaroSort),
        keitaroColumnOrder: normalizeKeitaroColumnOrder(state.keitaroColumnOrder),
        keitaroColumnWidths: normalizeKeitaroColumnWidths(state.keitaroColumnWidths),
        keitaroVisibleColumns: normalizeKeitaroVisibleColumns(
            state.keitaroVisibleColumns
        ),
        keitaroPageSize: keitaroPageSizeSet.has(Number(state.keitaroPageSize))
            ? Number(state.keitaroPageSize)
            : defaultState.keitaroPageSize,
        keitaroConcurrency: (() => {
            const value = Math.round(Number(state.keitaroConcurrency));
            if (!Number.isFinite(value)) return defaultState.keitaroConcurrency;
            return Math.min(
                keitaroConcurrencyMax,
                Math.max(keitaroConcurrencyMin, value)
            );
        })(),
        keitaroSubtab: ["offers", "streams"].includes(state.keitaroSubtab)
            ? state.keitaroSubtab
            : "campaigns",
        keitaroOffersGrouped: state.keitaroOffersGrouped === true,
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
