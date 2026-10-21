import { profileIds } from "./AutouploadStore.js";
import checkProfileSession from "../../workflows/autoupload/checkProfileSession.js";
import sendFriendRequest, { validateTargetUserId } from "../../facebook/autoupload/actions/friends/sendFriendRequest.js";

export default class AutouploadService {
    #clients = new Map();
    #running = new Set();
    #browserStates = new Map();
    #browserBusy = new Set();
    constructor({ store, adsPower, profileBrowser, onUpdated = () => {}, checkSession = checkProfileSession, sendFriendRequestFn = sendFriendRequest }) {
        Object.assign(this, { store, adsPower, profileBrowser, onUpdated, checkSession, sendFriendRequestFn });
    }
    async snapshot() {
        const state = await this.store.snapshot();
        return { ...state, profiles: state.profiles.map((item) => ({
            ...item, adsPowerOpen: this.#browserStates.get(item.profileId) ?? null,
            browserBusy: this.#browserBusy.has(item.profileId),
            ...(this.#running.has(item.profileId) ? { status: "checking", message: "Виконується перевірка" } : {}),
        })) };
    }
    async refreshBrowserStates() {
        const profiles = (await this.store.snapshot()).profiles;
        for (let offset = 0; offset < profiles.length; offset += 100) {
            const batch = profiles.slice(offset, offset + 100);
            const states = await this.profileBrowser.getAdsPowerProfileOpenStates(batch.map((item) => item.profileNo));
            for (const item of batch) {
                if (!this.#browserBusy.has(item.profileId)) this.#browserStates.set(item.profileId, states.get(item.profileNo) ?? null);
            }
        }
        return this.#publish();
    }
    async controlProfile(profileId, action) {
        if (!["open", "close"].includes(action)) throw new Error("Невідома дія профілю AdsPower");
        const [profile] = await this.selected([profileId]);
        if (this.#browserBusy.has(profileId)) throw new Error("Операція над цим профілем уже виконується");
        this.#browserBusy.add(profileId);
        try {
            await this.#publish();
            if (action === "open") {
                await this.profileBrowser.openAdsPowerProfile(profile.profileNo);
                this.#browserStates.set(profileId, true);
            } else {
                const isOpen = await this.profileBrowser.getAdsPowerProfileOpenState(profile.profileNo);
                if (isOpen === null) throw new Error("Не вдалося визначити стан профілю AdsPower");
                if (isOpen) {
                    try { await this.profileBrowser.closeAdsPowerProfile(profile.profileNo); }
                    catch {
                        // Якщо профіль закрили вручну під час запиту, повертаємо звичайний стан кнопки.
                        if (await this.profileBrowser.getAdsPowerProfileOpenState(profile.profileNo) !== false) {
                            throw new Error("Не вдалося закрити профіль AdsPower");
                        }
                    }
                }
                this.#browserStates.set(profileId, false);
            }
        } finally {
            this.#browserBusy.delete(profileId);
            await this.#publish();
        }
        return { profileId, adsPowerOpen: this.#browserStates.get(profileId) ?? null };
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
        const byId = new Map(profiles.map((profile) => [profile.profileId, profile]));
        return [...selected].map((id) => byId.get(id));
    }
    async check(ids, { signal, progress = async () => {} } = {}) {
        return this.#runProfiles(ids, { signal, progress });
    }
    async sendFriendRequests(ids, targetUserId, context = {}) {
        return this.#runProfiles(ids, { ...context, targetUserId: validateTargetUserId(targetUserId) });
    }
    async #runProfiles(ids, { signal, progress = async () => {}, targetUserId = null } = {}) {
        const profiles = await this.selected(ids);
        const results = [];
        for (const profile of profiles) {
            if (signal?.aborted) break;
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
                if (targetUserId) {
                    await progress({ stage: "friend-request", completed: results.length, total: profiles.length, message: `№${profile.profileNo}: надсилаємо заявку` });
                    let attempted = false;
                    const action = client ? await this.sendFriendRequestFn(client.getFbData(profile.profileId), targetUserId, {
                        signal, beforeSend: async () => { await this.store.beginFriendRequest(profile.profileId, targetUserId); attempted = true; },
                    }) : {
                        success: false, outcome: "NOT_SENT", code: "FACEBOOK_SESSION_PREPARATION_FAILED", message: result.message,
                        stage: result.stage, sessionStatus: result.status, outcomeUnknown: false, retryable: false, targetUserId,
                    };
                    const record = { ...action, attempted, fields: [], steps: [...result.steps, action.message] };
                    await this.store.recordAction(profile.profileId, record);
                    results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...record });
                } else results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...result });
            } catch (error) {
                if (signal?.aborted) {
                    await this.store.record(profile.profileId, {
                        status: "error", stage: "interrupted", message: "Перевірку сесії перервано", fields: [], steps: ["Перевірку сесії перервано"],
                    });
                    if (targetUserId) {
                        const interrupted = { success: false, outcome: "NOT_SENT", code: "TASK_INTERRUPTED", message: "Задачу перервано до надсилання заявки", targetUserId, outcomeUnknown: false, retryable: false, fields: [], steps: ["Задачу перервано до надсилання заявки"] };
                        await this.store.recordAction(profile.profileId, interrupted);
                        results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...interrupted });
                        break;
                    }
                }
                throw error;
            } finally {
                this.#running.delete(profile.profileId);
                await this.#publish();
            }
            await progress({ stage: targetUserId ? "friend-request" : "session", completed: results.length, total: profiles.length, message: `${targetUserId ? "Оброблено" : "Перевірено"} ${results.length} із ${profiles.length}` });
        }
        return { result: { profiles: results, ...(targetUserId ? { targetUserId } : {}) }, taskStatus: results.some((item) => targetUserId ? !item.success : item.status !== "active") ? "completed_with_warnings" : "completed" };
    }
}
