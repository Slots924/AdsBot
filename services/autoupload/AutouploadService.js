import { profileIds } from "./AutouploadStore.js";
import checkProfileSession from "../../workflows/autoupload/checkProfileSession.js";
import refreshProfileSession from "../../workflows/autoupload/refreshProfileSession.js";
import FacebookWebClient from "../../facebook/api/FacebookWebClient.js";
import sendFriendRequest, { validateTargetUserId } from "../../facebook/autoupload/actions/friends/sendFriendRequest.js";
import shareAdAccount from "../../facebook/autoupload/actions/adAccounts/shareAdAccount.js";
import { validateAdAccountId } from "../../facebook/autoupload/actions/adAccounts/common.js";
import { actionFailure } from "../../facebook/autoupload/graphql/errors.js";
import acceptIncomingFriendRequest from "../../facebook/autoupload/actions/friends/acceptIncomingFriendRequest.js";
import { safeDiagnosticText } from "../logging/httpDiagnostics.js";
import changeFacebookName, { validateName } from "../../facebook/autoupload/actions/accounts/changeFacebookName.js";
import { profileActions, validateProfileAction } from "../../facebook/autoupload/actions/profile/index.js";
import getFanPages from "../../facebook/autoupload/actions/pages/getFanPages.js";
import grantFanPageAccess from "../../facebook/autoupload/workflows/grantFanPageAccess.js";

export default class AutouploadService {
    #clients = new Map();
    #running = new Set();
    #browserStates = new Map();
    #browserBusy = new Set();
    #mutating = new Set();
    #pageLists = new Map();
    constructor({ store, adsPower, profileBrowser, sessionStore, onUpdated = () => {}, checkSession, sendFriendRequestFn = sendFriendRequest, shareAdAccountFn = shareAdAccount, acceptFriendRequestFn = acceptIncomingFriendRequest, changeNameFn = changeFacebookName,
        getFanPagesFn = getFanPages, grantFanPageAccessFn = grantFanPageAccess, checkPageSession = checkProfileSession }) {
        Object.assign(this, { getFanPagesFn, grantFanPageAccessFn, checkPageSession });
        this.changeNameFn = changeNameFn;
        Object.assign(this, { store, adsPower, profileBrowser, sessionStore, onUpdated, checkSession: checkSession ?? (sessionStore ? refreshProfileSession : checkProfileSession), sendFriendRequestFn, shareAdAccountFn, acceptFriendRequestFn });
    }
    #statusHandler(profileId) {
        return async ({ status, message }) => {
            await this.store.setAccountStatus(profileId, status, message);
            this.#clients.delete(profileId);
            await this.sessionStore?.remove(profileId);
            await this.#publish();
        };
    }
    async #prepare(profileId, context, refresh) {
        const onSessionStatus = this.#statusHandler(profileId);
        if (!refresh && (this.sessionStore || context.cachedOnly)) {
            try {
                let client = this.#clients.get(profileId);
                if (!client) {
                    const saved = await this.sessionStore?.load(profileId);
                    if (!saved) throw new Error();
                    client = FacebookWebClient.restore(saved, { onSessionStatus });
                }
                client.validateFbData(client.getFbData(profileId), { allowPageActor: true });
                return { client, result: { status: "active", message: "Використано збережену сесію Facebook", fields: [], steps: ["Сесію прочитано з локального сховища"] } };
            } catch {
                return { client: null, result: { status: "error", message: "Потрібна нова перевірка профілю: збережена сесія відсутня, застаріла або недоступна", fields: [], steps: ["Потрібна нова перевірка профілю"] } };
            }
        }
        this.#clients.delete(profileId);
        await this.sessionStore?.remove(profileId);
        const prepared = await this.checkSession({ profileId, adsPower: this.adsPower, onSessionStatus, ...context });
        if (prepared.client && this.sessionStore) await this.sessionStore.save(profileId, prepared.client.exportSession());
        return prepared;
    }
    async snapshot() {
        const state = await this.store.snapshot();
        return { ...state, profiles: state.profiles.map((item) => ({
            ...item, adsPowerOpen: this.#browserStates.get(item.profileId) ?? null,
            browserBusy: this.#browserBusy.has(item.profileId) || this.#mutating.has(item.profileId),
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
        if (this.#running.has(profileId) || this.#mutating.has(profileId)) throw new Error("Дочекайтеся завершення операції профілю");
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
    async mutate(payload = {}) {
        if (!["remove", "rename-profile"].includes(payload.action)) return this.#mutate(payload);
        const profiles = await this.selected(payload.action === "remove" ? payload.ids : [payload.id]);
        const ids = profiles.map(profile => profile.profileId);
        if (ids.some(id => this.#running.has(id) || this.#browserBusy.has(id) || this.#mutating.has(id))) throw new Error("Дочекайтеся завершення операції профілю");
        ids.forEach(id => this.#mutating.add(id));
        try {
            await this.#publish();
            await this.#mutate(payload);
        } finally {
            ids.forEach(id => this.#mutating.delete(id));
            await this.#publish();
        }
        return this.snapshot();
    }
    async #mutate({ action, id, name, ids, groupId = "new", deleteAdsPower = false } = {}) {
        if (["create", "rename", "delete"].includes(action)) await this.store.group(action, id, name);
        else if (action === "rename-profile") {
            await this.selected([id]);
            if (this.#running.has(id) || this.#browserBusy.has(id)) throw new Error("Дочекайтеся завершення операції профілю");
            const title = String(name ?? "").trim();
            if (!title || title.length > 100) throw new Error("Назва профілю має містити від 1 до 100 символів");
            await this.adsPower.updateProfileName(id, title);
            await this.store.renameProfile(id, title);
        }
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
            await this.selected(selected);
            if (selected.some((profileId) => this.#running.has(profileId) || this.#browserBusy.has(profileId))) throw new Error("Дочекайтеся завершення операції вибраних профілів");
            if (action === "remove" && deleteAdsPower === true) {
                try {
                    for (const profileId of selected) {
                        await this.adsPower.deleteProfile(profileId);
                        await this.store.editProfiles("remove", [profileId]);
                        this.#clients.delete(profileId);
                        await this.sessionStore?.remove(profileId);
                    }
                } finally { await this.#publish(); }
            } else await this.store.editProfiles(action, selected, groupId);
            if (action === "remove") {
                for (const profileId of selected) { this.#clients.delete(profileId); await this.sessionStore?.remove(profileId); }
            }
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

    async #withPageProfile(ids, operation) {
        const profiles = await this.selected(ids);
        if (profiles.length !== 1) throw new Error("Виберіть лише один профіль для роботи з фанками");
        const [profile] = profiles;
        const id = profile.profileId;
        if (this.#running.has(id) || this.#mutating.has(id) || this.#browserBusy.has(id)) throw new Error("Операція над профілем уже виконується");
        this.#running.add(id);
        let client;
        try {
            await this.#publish();
            const cached = await this.#prepare(id, {}, false);
            client = cached.client;
            if (!client) {
                const prepared = await this.checkPageSession({ profileId: id, adsPower: this.adsPower, onSessionStatus: this.#statusHandler(id) });
                if (!prepared.client) return { success: false, code: "FACEBOOK_SESSION_REQUIRED", message: prepared.result.message };
                client = prepared.client;
                await this.store.record(id, prepared.result);
            }
            this.#clients.set(id, client);
            return await operation(profile, client);
        } finally {
            if (client && this.sessionStore) {
                try {
                    client.validateFbData(client.getFbData(id), { allowPageActor: true });
                    await this.sessionStore.save(id, client.exportSession());
                } catch {
                    this.#clients.delete(id);
                    await this.sessionStore.remove(id).catch(() => {});
                }
            }
            this.#running.delete(id);
            await this.#publish();
        }
    }

    async listFanPages(ids) {
        return this.#withPageProfile(ids, async (profile, client) => {
            this.#pageLists.delete(profile.profileId);
            const result = await this.getFanPagesFn(client);
            if (result.success) this.#pageLists.set(profile.profileId, result.pages);
            return result;
        });
    }

    async shareFanPage({ ids, additionalProfileId, targetUserId } = {}) {
        const targetId = validateTargetUserId(targetUserId);
        const pageId = String(additionalProfileId ?? "").trim();
        if (!/^[1-9]\d{0,29}$/.test(pageId)) throw new Error("Вкажіть коректний ID фанки");
        return this.#withPageProfile(ids, async (profile, client) => {
            const page = this.#pageLists.get(profile.profileId)?.find(item => item.additionalProfileId === pageId);
            if (!page) throw new Error("Спочатку отримайте список фанок і виберіть фанку з нього");
            const credentials = await this.adsPower.getProfileById(profile.profileId);
            const result = await this.grantFanPageAccessFn(client, { additionalProfileId: pageId, targetUserId: targetId, password: credentials.password });
            const failures = { SESSION: "Не вдалося перевірити сесію Facebook.", SWITCH: "Не вдалося перемкнутися на фанку.",
                PERMISSIONS: "Не вдалося прочитати доступи фанки.", ENCRYPT: "Не вдалося підготувати підтвердження пароля.",
                REAUTH: "Facebook не підтвердив пароль.", INVITE: "Facebook не прийняв запрошення.",
            };
            const message = result.success
                ? result.outcome === "FULL_CONTROL_ALREADY_PRESENT" ? "Користувач уже має повний доступ."
                    : result.outcome === "INVITE_ALREADY_PENDING" ? "Запрошення вже очікує прийняття."
                        : result.verified === false ? "Facebook прийняв інвайт. Контрольне читання не завершилося." : "Запрошення з повним доступом надіслано."
                : result.outcomeUnknown ? "Результат запиту невідомий. Перевірте запрошення перед повторною спробою."
                    : `${failures[result.stage] || result.message || "Не вдалося надати доступ"}${result.graphCode ? ` · Facebook ${result.graphCode}` : ""}`;
            const action = { ...result, message, pageName: page.name, operation: "fan-page-share", fields: [], steps: [message],
                ...(result.outcomeUnknown ? { actionRequired: "check_page_invites" } : {}),
            };
            await this.store.recordAction(profile.profileId, action);
            if (["login_required", "checkpoint"].includes(result.sessionStatus)) {
                await this.#statusHandler(profile.profileId)({ status: result.sessionStatus, message });
            }
            return action;
        });
    }
    async check(ids, { signal, progress = async () => {} } = {}) {
        return this.#runProfiles(ids, { signal, progress });
    }
    async changeNames(ids, input, context = {}) {
        const name = validateName(input);
        return this.#runCachedAction(ids, (fbData, options) => this.changeNameFn(fbData, name, options), "profile-name-change", "зміна імені соціального профілю", context);
    }
    async runProfileAction(ids, action, input, context = {}) {
        const normalized = validateProfileAction(action, input);
        return this.#runCachedAction(ids, (fbData, options) => profileActions[action](fbData, normalized, options), `profile-${action}`, "дія соціального профілю", context);
    }
    async #runCachedAction(ids, execute, operation, label, { signal, progress = async () => {} } = {}) {
        const profiles = await this.selected(ids);
        const results = [];
        for (const profile of profiles) {
            if (signal?.aborted) break;
            const id = profile.profileId;
            if (this.#running.has(id) || this.#browserBusy.has(id) || this.#mutating.has(id)) throw new Error("Операція над профілем уже виконується");
            this.#running.add(id);
            try {
                await this.#publish();
                await progress({ stage: operation, completed: results.length, total: profiles.length, message: `№${profile.profileNo}: ${label}` });
                let action;
                try {
                    const prepared = await this.#prepare(id, { signal, cachedOnly: true }, false);
                    if (!prepared.client) action = { success: false, outcome: "NOT_SENT", message: prepared.result.message, code: "FACEBOOK_SESSION_PREPARATION_FAILED", retryable: false, outcomeUnknown: false };
                    else {
                        this.#clients.set(id, prepared.client);
                        action = await execute(prepared.client.getFbData(id), { signal });
                        if (["login_required", "checkpoint"].includes(action.sessionStatus)) await this.#statusHandler(id)({ status: action.sessionStatus, message: action.message });
                        else if (this.sessionStore) {
                            try { await this.sessionStore.save(id, prepared.client.exportSession()); }
                            catch { action = { ...action, storageWarning: "Не вдалося зберегти оновлену сесію" }; }
                        }
                    }
                } catch (error) { action = actionFailure(error); }
                const entry = { ...action, operation, fields: [], steps: [action.message] };
                await this.store.recordAction(id, entry);
                results.push({ profileId: id, profileNo: profile.profileNo, ...entry });
            } finally {
                this.#running.delete(id);
                await this.#publish();
            }
        }
        return { result: { profiles: results }, taskStatus: results.length !== profiles.length || results.some(item => !item.success || item.storageWarning) ? "completed_with_warnings" : "completed" };
    }
    async sendFriendRequests(ids, targetUserId, context = {}) {
        return this.#runProfiles(ids, { ...context, targetUserId: validateTargetUserId(targetUserId) });
    }
    async validateTransfer({ ids, targetProfileId } = {}) {
        const profiles = await this.selected(ids);
        const [target] = await this.selected([targetProfileId]);
        if (profiles.some(profile => profile.profileId === targetProfileId)) throw new Error("Кінг не може бути донором у цій операції");
        for (const profile of [...profiles, target]) {
            if (profile.assets?.adAccountsState !== "loaded") throw new Error(`№${profile.profileNo}: немає збереженого повного списку РК. Спочатку перевірте профіль`);
        }
        return { profiles, target };
    }
    async transferPersonalAccounts(input, { signal, progress = async () => {} } = {}) {
        const { profiles, target } = await this.validateTransfer(input);
        const locked = [...profiles, target].map(profile => profile.profileId);
        if (locked.some(id => this.#running.has(id) || this.#browserBusy.has(id) || this.#mutating.has(id))) throw new Error("Операція над одним із профілів уже виконується");
        locked.forEach(id => this.#running.add(id));
        const results = [];
        const targetAccounts = new Set(target.assets.adAccounts.map(account => String(account.accountId)));
        let targetClient;
        const record = async (profile, operation, action, extra = {}) => {
            const entry = { ...action, ...extra, operation, status: action.success ? "success" : "error", fields: [], steps: [action.message] };
            await this.store.recordAction(profile.profileId, entry);
            results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...entry });
            await this.#publish();
        };
        const savedClient = async (profile) => {
            const prepared = await this.#prepare(profile.profileId, { signal, cachedOnly: true }, false);
            if (!prepared.client) throw Object.assign(new Error(prepared.result.message), { safeFacebookError: true, code: "FACEBOOK_SESSION_PREPARATION_FAILED" });
            this.#clients.set(profile.profileId, prepared.client);
            return prepared.client;
        };
        try {
            await this.#publish();
            for (const profile of profiles) {
                if (signal?.aborted) break;
                try {
                    await progress({ stage: "personal-account-transfer", completed: profiles.indexOf(profile), total: profiles.length, message: `№${profile.profileNo}: передача персональних РК` });
                    const accounts = [...new Map(profile.assets.adAccounts.filter(account => account.isPersonal === true && !account.businessId && !targetAccounts.has(String(account.accountId))).map(account => [String(account.accountId), account])).values()];
                    if (!accounts.length) {
                        await record(profile, "personal-account-transfer", { success: true, outcome: "SKIPPED", message: "Пропущено: немає персональних РК, відсутніх у кінга" });
                        continue;
                    }
                    targetClient ??= await savedClient(target);
                    const client = await savedClient(profile);
                    const targetData = targetClient.getFbData(target.profileId);
                    const fbData = client.getFbData(profile.profileId);
                    const targetUserId = validateTargetUserId(targetData.userId);
                    const donorUserId = validateTargetUserId(fbData.userId);
                    if (targetUserId === donorUserId) throw Object.assign(new Error("Донор і кінг використовують один Facebook-акаунт"), { safeFacebookError: true, code: "FACEBOOK_TRANSFER_SELF" });
                    let attempted = false;
                    const sent = await this.sendFriendRequestFn(fbData, targetUserId, {
                        signal, beforeSend: async () => { await this.store.beginFriendRequest(profile.profileId, targetUserId); attempted = true; },
                    });
                    await record(profile, "friend-request", sent, { targetUserId, attempted });
                    // Навіть за помилки надсилання дружба могла вже існувати: приймаємо заявку та пробуємо передачу.
                    signal?.throwIfAborted();
                    const accepted = await this.acceptFriendRequestFn(targetData, donorUserId, { signal, attemptOnCheckFailure: true });
                    await record(target, "friend-request-accept", accepted, { targetUserId: donorUserId });
                    for (const account of accounts) {
                        signal?.throwIfAborted();
                        const adAccountId = validateAdAccountId(account.accountId);
                        if (targetAccounts.has(adAccountId)) continue;
                        let attemptedShare = false;
                        const shared = await this.shareAdAccountFn(fbData, adAccountId, targetUserId, {
                            signal, useCachedAccess: true,
                            confirmation: { confirmed: true, adAccountId, targetUserId, role: "ADMIN" },
                            beforeSend: async () => { await this.store.beginAdAccountShare(profile.profileId, adAccountId, targetUserId); attemptedShare = true; },
                        });
                        if (shared.success) {
                            // Зберігаємо доступ до наступного донора та наступного запуску без повторного читання Facebook.
                            await this.store.addSharedAccount(target.profileId, account);
                            targetAccounts.add(adAccountId);
                        }
                        await record(profile, "ad-account-share", shared, { adAccountId, targetUserId, attempted: attemptedShare });
                    }
                    if (this.sessionStore) {
                        for (const id of [profile.profileId, target.profileId]) {
                            const cached = this.#clients.get(id);
                            if (cached) await this.sessionStore.save(id, cached.exportSession());
                        }
                    }
                } catch (error) {
                    const failure = actionFailure(error);
                    if (!error.safeFacebookError) failure.message = safeDiagnosticText(error.message || failure.message);
                    await record(profile, "personal-account-transfer", failure);
                    if (signal?.aborted) break;
                }
            }
        } finally {
            locked.forEach(id => this.#running.delete(id));
            await this.#publish();
        }
        return { result: { profiles: results, targetProfileId: target.profileId }, taskStatus: signal?.aborted || results.some(item => !item.success) ? "completed_with_warnings" : "completed" };
    }
    async validateShareSelection({ ids, accounts, targetUserId, confirmed } = {}) {
        if (confirmed !== true) throw new Error("Підтвердьте надання Admin-доступу до вибраних РК");
        const targetId = validateTargetUserId(targetUserId);
        const profiles = await this.selected(ids);
        if (!Array.isArray(accounts) || !accounts.length || accounts.length > 1000) throw new Error("Оберіть від 1 до 1000 рекламних кабінетів");
        const seen = new Set();
        const selection = accounts.map((item) => {
            const profile = profiles.find(profile => profile.profileId === item?.profileId);
            const adAccountId = validateAdAccountId(item?.adAccountId);
            if (!profile || !profile.assets?.adAccounts?.some(account => account.accountId === adAccountId && account.isPersonal === true && !account.businessId)) {
                throw new Error("РК відсутній серед перевірених персональних кабінетів вибраного профілю. Оновіть перевірку");
            }
            if (seen.has(adAccountId)) throw new Error("Один рекламний кабінет не можна вибирати через кілька профілів одночасно");
            seen.add(adAccountId);
            return { profileId: profile.profileId, adAccountId };
        });
        return { profiles: profiles.filter(profile => selection.some(item => item.profileId === profile.profileId)), accounts: selection, targetUserId: targetId, confirmed: true };
    }
    async shareAdAccounts(input, { signal, progress = async () => {} } = {}) {
        const { profiles, accounts, targetUserId } = await this.validateShareSelection(input);
        const results = [];
        for (const profile of profiles) {
            if (signal?.aborted) break;
            if (this.#running.has(profile.profileId) || this.#mutating.has(profile.profileId) || this.#browserBusy.has(profile.profileId)) throw new Error("Операція над профілем уже виконується");
            this.#running.add(profile.profileId);
            let client;
            try {
                await this.#publish();
                const prepared = await this.#prepare(profile.profileId, { signal }, false);
                let sessionFailure = prepared.result;
                client = prepared.client;
                if (client) this.#clients.set(profile.profileId, client);
                for (const account of accounts.filter(item => item.profileId === profile.profileId)) {
                    if (signal?.aborted) break;
                    await progress({ stage: "ad-account-share", completed: results.length, total: accounts.length, message: `№${profile.profileNo} · РК ${account.adAccountId}: надання Admin-доступу` });
                    let attempted = false;
                    let action;
                    try {
                        action = client ? await this.shareAdAccountFn(client.getFbData(profile.profileId), account.adAccountId, targetUserId, {
                            signal, confirmation: { confirmed: true, adAccountId: account.adAccountId, targetUserId, role: "ADMIN" },
                            beforeSend: async () => { await this.store.beginAdAccountShare(profile.profileId, account.adAccountId, targetUserId); attempted = true; },
                        }) : { success: false, outcome: "NOT_SENT", code: "FACEBOOK_SESSION_PREPARATION_FAILED", message: sessionFailure.message, sessionStatus: sessionFailure.sessionStatus ?? sessionFailure.status, retryable: false, outcomeUnknown: false };
                    } catch (error) {
                        action = actionFailure(error);
                        if (attempted) Object.assign(action, { outcomeUnknown: true, actionRequired: "check_ad_account_permissions", outcome: "OUTCOME_UNKNOWN" });
                    }
                    const record = { ...action, operation: "ad-account-share", adAccountId: account.adAccountId, targetUserId, attempted, fields: [], steps: [action.message] };
                    await this.store.recordAction(profile.profileId, record);
                    results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...record });
                    if (["login_required", "checkpoint"].includes(action.sessionStatus)) {
                        await this.#statusHandler(profile.profileId)({ status: action.sessionStatus, message: action.message });
                        client = null;
                        sessionFailure = action;
                    }
                    await this.#publish();
                }
                if (client && this.sessionStore) await this.sessionStore.save(profile.profileId, client.exportSession());
            } finally {
                this.#running.delete(profile.profileId);
                await this.#publish();
            }
        }
        await progress({ stage: "ad-account-share", completed: results.length, total: accounts.length, message: `Оброблено ${results.length} із ${accounts.length} РК` });
        return { result: { accounts: results, targetUserId }, taskStatus: results.some(item => !item.success) || results.length !== accounts.length ? "completed_with_warnings" : "completed" };
    }
    async #runProfiles(ids, { signal, progress = async () => {}, targetUserId = null } = {}) {
        const profiles = await this.selected(ids);
        const results = [];
        for (const profile of profiles) {
            if (signal?.aborted) break;
            if (this.#running.has(profile.profileId) || this.#mutating.has(profile.profileId) || this.#browserBusy.has(profile.profileId)) throw new Error("Операція над профілем уже виконується");
            this.#running.add(profile.profileId);
            try {
                await this.#publish();
                const { client, result } = await this.#prepare(profile.profileId, {
                    signal,
                    onStage: (message) => progress({ stage: "session", completed: results.length, total: profiles.length, message: `№${profile.profileNo}: ${message}` }),
                }, !targetUserId);
                if (targetUserId && !client && ["login_required", "checkpoint"].includes(profile.status)) result.status = profile.status;
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
                    if (["login_required", "checkpoint"].includes(action.sessionStatus)) {
                        await this.#statusHandler(profile.profileId)({ status: action.sessionStatus, message: action.message });
                    }
                    if (client && this.sessionStore && !["login_required", "checkpoint"].includes(action.sessionStatus)) {
                        await this.sessionStore.save(profile.profileId, client.exportSession());
                    }
                    results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...record });
                } else results.push({ profileId: profile.profileId, profileNo: profile.profileNo, ...result });
            } catch (error) {
                if (!signal?.aborted && !targetUserId) {
                    await this.store.record(profile.profileId, {
                        status: "error", stage: "storage", message: "Не вдалося оновити або зберегти сесії профілю. Повторіть перевірку", fields: [], steps: ["Перевірка не завершена"],
                        capabilities: { facebook: false, adsManager: false, accessToken: false },
                        assets: { adAccounts: [], pages: [], adAccountsState: "unavailable", pagesState: "unavailable" },
                    });
                }
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
        return { result: { profiles: results, ...(targetUserId ? { targetUserId } : {}) }, taskStatus: results.some((item) => targetUserId ? !item.success : item.status !== "active" || item.hasWarnings) ? "completed_with_warnings" : "completed" };
    }
}
