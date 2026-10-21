import { profileIds } from "./AutouploadStore.js";
import checkProfileSession from "../../workflows/autoupload/checkProfileSession.js";

export default class AutouploadService {
    #clients = new Map();
    #running = new Set();
    constructor({ store, adsPower, onUpdated = () => {}, checkSession = checkProfileSession }) {
        Object.assign(this, { store, adsPower, onUpdated, checkSession });
    }
    async snapshot() {
        const state = await this.store.snapshot();
        return { ...state, profiles: state.profiles.map((item) => this.#running.has(item.profileId) ? { ...item, status: "checking", message: "Виконується перевірка" } : item) };
    }
    async #publish() {
        const snapshot = await this.snapshot();
        this.onUpdated(snapshot);
        return snapshot;
    }
    async mutate({ action, id, name, ids, groupId = "new" } = {}) {
        if (["create", "rename", "delete"].includes(action)) await this.store.group(action, id, name);
        else if (action === "add") {
            const profiles = [];
            for (const profileId of profileIds(ids)) {
                let source;
                try { source = await this.adsPower.getProfileById(profileId); }
                catch { throw new Error("Не вдалося прочитати вибрані профілі AdsPower. Список не змінено"); }
                profiles.push({ profileId, profileNo: String(source.profile_no), name: String(source.name ?? "") });
            }
            await this.store.add(profiles, groupId);
        } else if (["move", "remove"].includes(action)) {
            const selected = profileIds(ids);
            if (selected.some((profileId) => this.#running.has(profileId))) throw new Error("Дочекайтеся завершення перевірки вибраних профілів");
            await this.store.editProfiles(action, selected, groupId);
            if (action === "remove") selected.forEach((profileId) => this.#clients.delete(profileId));
        } else throw new Error("Невідома дія автозаливів");
        return this.#publish();
    }
    async selected(ids) {
        const selected = new Set(profileIds(ids));
        const profiles = (await this.store.snapshot()).profiles.filter((item) => selected.has(item.profileId));
        if (profiles.length !== selected.size) throw new Error("Один із вибраних профілів уже прибрано зі списку");
        return profiles;
    }
    async check(ids, { signal, progress = async () => {} } = {}) {
        const profiles = await this.selected(ids);
        const results = [];
        for (const profile of profiles) {
            signal?.throwIfAborted();
            if (this.#running.has(profile.profileId)) throw new Error("Цей профіль уже перевіряється");
            this.#running.add(profile.profileId);
            this.#clients.delete(profile.profileId);
            try {
                await this.#publish();
                const { client, result } = await this.checkSession({
                    profileId: profile.profileId, adsPower: this.adsPower, signal,
                    onStage: (message) => progress({ stage: "session", completed: results.length, total: profiles.length, message: `№${profile.profileNo}: ${message}` }),
                });
                await this.store.record(profile.profileId, result);
                if (client) this.#clients.set(profile.profileId, client);
                results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...result });
            } catch (error) {
                if (signal?.aborted) {
                    await this.store.record(profile.profileId, {
                        status: "error", stage: "interrupted", message: "Перевірку сесії перервано", fields: [], steps: ["Перевірку сесії перервано"],
                    });
                }
                throw error;
            } finally {
                this.#running.delete(profile.profileId);
                await this.#publish();
            }
            await progress({ stage: "session", completed: results.length, total: profiles.length, message: `Перевірено ${results.length} із ${profiles.length}` });
        }
        return { result: { profiles: results }, taskStatus: results.some((item) => item.status !== "active") ? "completed_with_warnings" : "completed" };
    }
}
