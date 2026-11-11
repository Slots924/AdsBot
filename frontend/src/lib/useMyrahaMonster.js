import { useEffect, useSyncExternalStore } from "react";
import { unwrap } from "./api.js";

const initial = { status: "idle", pages: {}, busy: {}, errors: {}, message: "", revision: null };

// Спільний стан за ID фанки переживає зміну профілю та закриття вкладки.
const stores = new WeakMap();

function createStore(api) {
    const live = { current: initial };
    const generation = { current: 0 };
    const listRequest = { current: 0 };
    const versions = { current: {} };
    const listeners = new Set();
    const commit = (update) => {
        live.current = typeof update === "function" ? update(live.current) : update;
        listeners.forEach((listener) => listener());
    };
    const invalidate = () => {
        generation.current += 1;
        listRequest.current += 1;
        versions.current = {};
        commit(initial);
    };
    const loadSettings = async () => {
        const epoch = generation.current;
        try {
            if (!api?.getMyrahaMonsterSettings) {
                commit({ ...initial, status: "unconfigured" });
                return;
            }
            const settings = await unwrap(api.getMyrahaMonsterSettings());
            if (epoch !== generation.current) return;
            if (!settings.hasApiKey || (live.current.revision !== null && live.current.revision !== settings.revision)) {
                invalidate();
                commit({ ...initial, status: settings.hasApiKey ? "idle" : "unconfigured", revision: settings.revision });
                return;
            }
            if (live.current.status === "idle" && api.getMyrahaMonsterCachedPages) {
                const request = listRequest.current;
                const cached = await unwrap(api.getMyrahaMonsterCachedPages());
                // Кеш відновлюємо лише до початку оновлення або перемикання.
                if (epoch !== generation.current || request !== listRequest.current || live.current.status !== "idle") return;
                if (cached.revision === settings.revision && Array.isArray(cached.items)) {
                    commit({ ...initial, status: "ready", revision: cached.revision,
                        pages: Object.fromEntries(cached.items.map((item) => [item.id, item])) });
                }
            }
        } catch (error) {
            if (epoch === generation.current) commit((previous) => ({ ...previous, status: "error", message: error.message }));
        }
    };

    const refresh = async (reset = false) => {
        if (!api?.getMyrahaMonsterSettings) {
            commit({ ...initial, status: "unconfigured" });
            return;
        }
        if (reset) {
            generation.current += 1;
            versions.current = {};
            commit(initial);
        }
        const epoch = generation.current;
        const request = ++listRequest.current;
        const startedVersions = { ...versions.current };
        const wasBusy = { ...live.current.busy };
        const current = () => epoch === generation.current && request === listRequest.current;
        commit((previous) => ({ ...previous, status: "loading", message: "" }));
        try {
            const settings = await unwrap(api.getMyrahaMonsterSettings());
            if (!current()) return;
            if (!settings.hasApiKey) {
                commit({ ...initial, status: "unconfigured", revision: settings.revision });
                return;
            }
            const result = await unwrap(api.getMyrahaMonsterPages());
            if (!current()) return;
            if (result.revision !== settings.revision) { await refresh(true); return; }
            commit((previous) => {
                const pages = Object.fromEntries(result.items.map((item) => [item.id, item]));
                const errors = {};
                // Відповідь списку не повинна перезаписати новіший результат перемикання.
                for (const id of new Set([...Object.keys(previous.pages), ...Object.keys(previous.busy), ...Object.keys(previous.errors)])) {
                    if (wasBusy[id] || previous.busy[id] || versions.current[id] !== startedVersions[id]) {
                        if (previous.pages[id]) pages[id] = previous.pages[id];
                        else delete pages[id];
                        if (previous.errors[id]) errors[id] = previous.errors[id];
                    }
                }
                return { ...previous, status: "ready", pages, errors, revision: result.revision, message: "" };
            });
        } catch (error) {
            if (!current()) return;
            if (error.code === "MYRAHA_STALE") { await refresh(true); return; }
            commit((previous) => ({ ...previous, status: error.code === "MYRAHA_NO_KEY" ? "unconfigured" : "error", message: error.message }));
        }
    };

    const operate = async (id, enabled, checkOnly = false) => {
        id = String(id);
        const before = live.current;
        if (before.busy[id] || before.status !== "ready") return;
        if (!checkOnly && (!before.pages[id]?.integrationReady || before.errors[id])) return;
        const epoch = generation.current;
        const version = (versions.current[id] ?? 0) + 1;
        versions.current[id] = version;
        const current = () => epoch === generation.current && version === versions.current[id];
        commit((previous) => ({ ...previous, busy: { ...previous.busy, [id]: true } }));
        try {
            const result = await unwrap(checkOnly
                ? api.getMyrahaMonsterPage(id)
                : api.setMyrahaMonsterModeration(id, enabled));
            if (!current()) return;
            if (result.revision !== live.current.revision) { await refresh(true); return; }
            commit((previous) => {
                const errors = { ...previous.errors };
                delete errors[id];
                return { ...previous, pages: { ...previous.pages, [id]: { ...previous.pages[id], ...result } }, errors };
            });
        } catch (error) {
            if (!current()) return;
            if (error.code === "MYRAHA_STALE") { await refresh(true); return; }
            if (error.httpStatus === 401 || error.code === "MYRAHA_NO_KEY") listRequest.current += 1;
            commit((previous) => {
                if (error.httpStatus === 401 || error.code === "MYRAHA_NO_KEY") {
                    return { ...previous, status: "error", message: error.message };
                }
                const unavailable = [403, 404].includes(error.httpStatus);
                return { ...previous,
                    pages: unavailable ? { ...previous.pages, [id]: { ...previous.pages[id], integrationReady: false } } : previous.pages,
                    errors: { ...previous.errors, [id]: { message: error.message, unavailable } } };
            });
        } finally {
            if (current()) {
                versions.current[id] += 1;
                commit((previous) => ({ ...previous, busy: { ...previous.busy, [id]: false } }));
            }
        }
    };

    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSnapshot: () => live.current,
        loadSettings,
        settingsChanged() { invalidate(); return loadSettings(); },
        refresh: () => refresh(),
        toggle: (id, enabled) => operate(id, enabled),
        check: (id) => operate(id, false, true),
    };
}

const unavailableApi = {};
export default function useMyrahaMonster() {
    const api = window.adsBot ?? unavailableApi;
    if (!stores.has(api)) stores.set(api, createStore(api));
    const store = stores.get(api);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    useEffect(() => {
        store.loadSettings();
        return api.onMyrahaMonsterSettingsChanged?.(store.settingsChanged);
    }, [api, store]);
    return { ...state, refresh: store.refresh, toggle: store.toggle, check: store.check };
}
