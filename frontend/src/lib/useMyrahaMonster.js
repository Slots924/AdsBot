import { useCallback, useEffect, useRef, useState } from "react";
import { unwrap } from "./api.js";

const initial = { status: "loading", pages: {}, busy: {}, errors: {}, message: "", revision: null };

export default function useMyrahaMonster() {
    const [state, setState] = useState(initial);
    const live = useRef(state);
    const generation = useRef(0);
    const listRequest = useRef(0);
    const versions = useRef({});
    const active = useRef(false);
    const commit = useCallback((update) => {
        if (!active.current) return;
        live.current = typeof update === "function" ? update(live.current) : update;
        setState(live.current);
    }, []);

    const refresh = useCallback(async (reset = false) => {
        if (!window.adsBot?.getMyrahaMonsterSettings) {
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
        const current = () => active.current && epoch === generation.current && request === listRequest.current;
        commit((previous) => ({ ...previous, status: "loading", message: "" }));
        try {
            const settings = await unwrap(window.adsBot.getMyrahaMonsterSettings());
            if (!current()) return;
            if (!settings.hasApiKey) {
                commit({ ...initial, status: "unconfigured", revision: settings.revision });
                return;
            }
            const result = await unwrap(window.adsBot.getMyrahaMonsterPages());
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
    }, [commit]);

    const operate = useCallback(async (id, enabled, checkOnly = false) => {
        id = String(id);
        const before = live.current;
        if (before.busy[id] || before.status !== "ready") return;
        if (!checkOnly && (!before.pages[id]?.integrationReady || before.errors[id])) return;
        const epoch = generation.current;
        const version = (versions.current[id] ?? 0) + 1;
        versions.current[id] = version;
        const current = () => active.current && epoch === generation.current && version === versions.current[id];
        commit((previous) => ({ ...previous, busy: { ...previous.busy, [id]: true } }));
        try {
            const result = await unwrap(checkOnly
                ? window.adsBot.getMyrahaMonsterPage(id)
                : window.adsBot.setMyrahaMonsterModeration(id, enabled));
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
    }, [commit, refresh]);

    useEffect(() => {
        active.current = true;
        refresh(true);
        const unsubscribe = window.adsBot?.onMyrahaMonsterSettingsChanged?.(() => refresh(true));
        return () => {
            active.current = false;
            generation.current += 1;
            unsubscribe?.();
        };
    }, [refresh]);

    return { ...state, refresh: () => refresh(), toggle: (id, enabled) => operate(id, enabled), check: (id) => operate(id, false, true) };
}
