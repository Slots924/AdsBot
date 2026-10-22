import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const initial = () => ({ version: 1, groups: [{ id: "new", name: "Нові" }], profiles: [], history: [] });
export const profileIds = (value) => {
    if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error("Оберіть від 1 до 1000 профілів");
    const ids = [...new Set(value.map(String))];
    if (ids.some((id) => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error("Некоректний ID профілю");
    return ids;
};

export default class AutouploadStore {
    #queue = Promise.resolve();
    constructor(file) { this.file = file; }

    async #read() {
        try {
            const value = JSON.parse(await readFile(this.file, "utf8"));
            if (value.version !== 1 || !Array.isArray(value.groups) || !Array.isArray(value.profiles) || !Array.isArray(value.history)
                || !value.groups.some((group) => group.id === "new")) throw new Error();
            return value;
        } catch (error) {
            if (error.code === "ENOENT") return initial();
            throw new Error("Не вдалося прочитати сховище автозаливів. Дані не перезаписано");
        }
    }

    async snapshot() {
        await this.#queue;
        return this.#read();
    }

    change(action) {
        const operation = this.#queue.then(async () => {
            const state = await this.#read();
            await action(state);
            await mkdir(path.dirname(this.file), { recursive: true });
            await writeFile(`${this.file}.tmp`, JSON.stringify(state, null, 2), "utf8");
            await rename(`${this.file}.tmp`, this.file);
            return state;
        });
        this.#queue = operation.catch(() => {});
        return operation;
    }

    group(action, id, name) {
        return this.change((state) => {
            if (!["create", "rename", "delete"].includes(action)) throw new Error("Невідома дія над групою");
            const group = state.groups.find((item) => item.id === id);
            if (action !== "create" && !group) throw new Error("Групу не знайдено");
            if (action === "delete") {
                if (id === "new") throw new Error("Групу «Нові» не можна видалити");
                state.groups = state.groups.filter((item) => item.id !== id);
                state.profiles.forEach((profile) => { if (profile.groupId === id) profile.groupId = "new"; });
                return;
            }
            const title = String(name ?? "").trim();
            if (!title || title.length > 100) throw new Error("Назва групи має містити від 1 до 100 символів");
            if (state.groups.some((item) => item.id !== (action === "rename" ? id : null) && item.name.toLocaleLowerCase() === title.toLocaleLowerCase())) {
                throw new Error("Група з такою назвою вже існує");
            }
            if (action === "create") state.groups.push({ id: randomUUID(), name: title });
            else group.name = title;
        });
    }

    add(profiles, groupId) {
        return this.change((state) => {
            if (!state.groups.some((group) => group.id === groupId)) throw new Error("Групу не знайдено");
            for (const source of profiles) {
                const existing = state.profiles.find((item) => item.profileId === source.profileId);
                if (existing) Object.assign(existing, source, { groupId });
                else state.profiles.push({ ...source, groupId, status: "unchecked", message: "Ще не перевірено", addedAt: new Date().toISOString(), checkedAt: null });
            }
        });
    }

    editProfiles(action, ids, groupId) {
        const selected = new Set(profileIds(ids));
        return this.change((state) => {
            if (action === "remove") state.profiles = state.profiles.filter((item) => !selected.has(item.profileId));
            else if (action === "move") {
                if (!state.groups.some((group) => group.id === groupId)) throw new Error("Групу не знайдено");
                state.profiles.forEach((item) => { if (selected.has(item.profileId)) item.groupId = groupId; });
            } else throw new Error("Невідома дія над профілями");
        });
    }

    addSharedAccount(profileId, account) {
        return this.change((state) => {
            const profile = state.profiles.find(item => item.profileId === profileId);
            if (!profile) throw new Error("Профіль кінга прибрано зі списку");
            if (!profile.assets.adAccounts.some(item => String(item.accountId) === String(account.accountId))) {
                profile.assets.adAccounts.push({ ...account });
            }
        });
    }

    renameProfile(profileId, name) {
        return this.change((state) => {
            const profile = state.profiles.find(item => item.profileId === profileId);
            if (!profile) throw new Error("Профіль прибрано зі списку");
            profile.name = name;
        });
    }

    record(profileId, result) {
        return this.change((state) => {
            const profile = state.profiles.find((item) => item.profileId === profileId);
            if (!profile) return;
            const checkedAt = new Date().toISOString();
            Object.assign(profile, { status: result.status, message: result.message, checkedAt });
            if (result.assets) profile.assets = result.assets;
            if (result.capabilities) profile.capabilities = result.capabilities;
            profile.checkWarnings = result.warnings ?? [];
            state.history = [{ id: randomUUID(), profileId, profileNo: profile.profileNo, checkedAt, ...result }, ...state.history].slice(0, 500);
        });
    }

    setAccountStatus(profileId, status, message) {
        return this.change((state) => {
            const profile = state.profiles.find((item) => item.profileId === profileId);
            if (profile) Object.assign(profile, { status, message });
        });
    }

    beginFriendRequest(profileId, targetUserId) {
        return this.change((state) => {
            if (!state.profiles.some((profile) => profile.profileId === profileId)) throw new Error("Профіль прибрано зі списку");
            state.friendRequests ??= {};
            const key = `${profileId}:${targetUserId}`;
            const previous = state.friendRequests[key];
            if (previous?.success) throw Object.assign(new Error("Заявку цьому отримувачу вже підтверджено раніше"), {
                code: "FRIEND_REQUEST_ALREADY_SENT", safeFacebookError: true,
            });
            if (previous?.outcomeUnknown) throw Object.assign(new Error("Попередній результат невідомий. Перевірте стан дружби перед новою спробою"), {
                code: "FRIEND_REQUEST_PREVIOUS_OUTCOME_UNKNOWN", safeFacebookError: true, outcomeUnknown: true, actionRequired: "check_friendship_status",
            });
            // Запис до POST зберігає невизначений результат навіть після аварійного завершення програми.
            state.friendRequests[key] = { outcomeUnknown: true, success: false, targetUserId, startedAt: new Date().toISOString() };
        });
    }

    beginAdAccountShare(profileId, adAccountId, targetUserId) {
        return this.change((state) => {
            if (!state.profiles.some((profile) => profile.profileId === profileId)) throw new Error("Профіль прибрано зі списку");
            state.adAccountShares ??= {};
            const key = `${profileId}:${adAccountId}:${targetUserId}`;
            if (state.adAccountShares[key]?.outcomeUnknown) throw Object.assign(new Error("Попередній результат зміни доступів невідомий. Перевірте права РК перед повтором"), {
                code: "AD_ACCOUNT_SHARE_PREVIOUS_OUTCOME_UNKNOWN", safeFacebookError: true, outcomeUnknown: true, actionRequired: "check_ad_account_permissions",
            });
            // Намір зберігається до POST, щоб аварія не спричинила сліпий повтор.
            state.adAccountShares[key] = { success: false, outcomeUnknown: true, adAccountId, targetUserId, startedAt: new Date().toISOString() };
        });
    }

    recordAction(profileId, result) {
        return this.change((state) => {
            const profile = state.profiles.find((item) => item.profileId === profileId);
            if (!profile) return;
            const checkedAt = new Date().toISOString();
            const entry = { ...result, operation: result.operation ?? "friend-request", checkedAt };
            profile.lastAction = entry;
            if (["login_required", "checkpoint"].includes(result.sessionStatus)) {
                Object.assign(profile, { status: result.sessionStatus, message: result.message });
            }
            state.history = [{ id: randomUUID(), profileId, profileNo: profile.profileNo, ...entry }, ...state.history].slice(0, 500);
            if (entry.operation === "ad-account-share" && (result.attempted || result.success)) {
                state.adAccountShares ??= {};
                state.adAccountShares[`${profileId}:${result.adAccountId}:${result.targetUserId}`] = entry;
            }
            if (entry.operation === "friend-request" && result.attempted && !["FRIEND_REQUEST_ALREADY_SENT", "FRIEND_REQUEST_PREVIOUS_OUTCOME_UNKNOWN"].includes(result.code)) {
                state.friendRequests ??= {};
                state.friendRequests[`${profileId}:${result.targetUserId}`] = entry;
            }
        });
    }
}
