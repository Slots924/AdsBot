import { randomUUID } from "node:crypto";
import FacebookWebClient from "../../facebook/api/FacebookWebClient.js";
import refreshProfileSession from "../../workflows/autoupload/refreshProfileSession.js";
import HttpAdsManagerContext from "../../facebook/autoupload/HttpAdsManagerContext.js";
import getBusinessInfo from "../../facebook/api-actions/ads-manager/getAdAccountBusinessInfo.js";
import checkBilling from "../../facebook/api-actions/ads-manager/checkBillingAccountInformation.js";
import updateBusiness from "../../facebook/api-actions/ads-manager/updateBusinessInfo.js";
import getPaymentSources from "../../facebook/api-actions/ads-manager/getAdAccountPaymentSources.js";
import requestPhoneCode from "../../facebook/api-actions/phone-verification/requestPhoneVerificationCode.js";
import submitPhoneCode from "../../facebook/api-actions/phone-verification/submitPhoneVerificationCode.js";
import addCard from "../../facebook/autoupload/actions/billing/addCreditCard.js";
import { tracedAction, withHttpWorkflow } from "../reports/HttpExchangeTrace.js";
import handleSessionFailure from "../../workflows/autoupload/handleSessionFailure.js";
import { HUMAN_CONFIRMATION_REQUIRED } from "../../facebook/session/sessionStatus.js";

const checked = result => {
    if (!result?.success) throw Object.assign(new Error(result?.error || result?.message || "Facebook не підтвердив дію"),
        { code: result?.code || result?.status || "FACEBOOK_ACTION_FAILED", stage: result?.stage,
            sessionStatus: result?.sessionStatus, banTag: result?.banTag, banWarning: result?.banWarning,
            actionRequired: result?.actionRequired, safeFacebookError: Boolean(result?.sessionStatus) });
    return result.data;
};

// Сесії HTTP і браузера незалежні; секретний знімок зберігається лише у захищеному сховищі.
export default class PersonalAutouploadSessionManager {
    sessions = new Map();
    starting = new Set();
    constructor(options) { Object.assign(this, options); }
    async handleRestriction(profileId, result) {
        const handled = await handleSessionFailure({ result, adsPower: this.adsPower, profileId });
        if (handled.stopProfile) {
            Object.assign(result, handled);
            for (const [id, session] of this.sessions) {
                if (session.profileId === profileId) this.sessions.delete(id);
            }
            try { await this.sessionStore.remove(profileId); }
            catch { result.storageWarning = "Не вдалося видалити неактуальну сесію"; }
        }
        return handled.stopProfile ? handled : undefined;
    }
    publicSession(session) {
        return { id: session.id, profileNo: session.profileNo, profileId: session.profileId,
            profileName: session.profile.name, profile: session.profile, context: "HTTP_ADS_MANAGER",
            actorId: session.client.getFbData(session.profileId).userId, connected: true, overview: session.overview };
    }
    async reported(action, profileNo, execute) {
        const id = randomUUID();
        const task = { id: null, type: "personal-autoupload", name: `Персональні автоаплоад · ${action} · №${profileNo}`,
            input: { profileNo }, startedAt: new Date().toISOString() };
        const save = (status, result, error) => this.reportManager?.createFromTask({ ...task, status, result,
            finishedAt: status === "running" ? null : new Date().toISOString(),
            error: error ? { code: error.code, sessionStatus: error.sessionStatus,
                banTag: error.banTag, banWarning: error.banWarning,
                message: error.sessionStatus === HUMAN_CONFIRMATION_REQUIRED ? error.message : "Дія завершилася помилкою; дивіться HTTP-історію" } : null,
            metadata: { httpHistory: result?.httpHistory || error?.httpHistory },
        }, {}, { reportId: id });
        try {
            const value = await withHttpWorkflow(`personal-autoupload.${action}`, () =>
                tracedAction(action, async () => ({ value: await execute() }))(), {
                directory: this.reportManager?.httpHistoryDirectory,
                metadata: { profileNo }, onStart: httpHistory => save("running", { httpHistory }),
            });
            let storageWarning = value?.httpHistory?.storageWarning || null;
            await Promise.resolve(save(value.value?.sessionStatus === HUMAN_CONFIRMATION_REQUIRED ? "failed" : storageWarning || value.value?.success === false || value.value?.storageWarning || value.value?.profileUpdateWarning || value.value?.refreshError ? "completed_with_warnings" : "completed", value))
                .catch(() => { storageWarning = "Дію виконано, але звіт не вдалося повністю зберегти"; });
            return storageWarning && value.value && !Array.isArray(value.value) ? { ...value.value, storageWarning } : value.value;
        } catch (error) { await save("failed", error.result, error)?.catch(() => {}); throw error; }
    }
    async start({ profileNo, force = false }) {
        const no = String(profileNo ?? "").trim();
        if (!/^\d+$/.test(no)) throw new Error("Вкажіть номер профілю");
        if (this.starting.has(no) || [...this.sessions.values()].some(item => item.profileNo === no && item.busy)) throw new Error("Операція профілю вже виконується");
        this.starting.add(no);
        try { return await this.reported("start", no, async () => {
            const raw = await this.adsPower.getProfileByNo(no);
            const profileId = String(raw.profile_id || raw.user_id);
            const profile = { profileId, profileNo: no, name: String(raw.name || ""), groupId: String(raw.group_id || ""), tags: [] };
            let client;
            if (!force) {
                try {
                    const saved = await this.sessionStore.load(profileId);
                    if (saved) {
                        client = this.restoreClient(saved, { onSessionStatus: result => this.handleRestriction(profileId, result) });
                        client.getAdsManagerData(client.getFbData(profileId));
                    }
                } catch { client = null; }
            }
            if (!client) {
                const prepared = await this.refreshSession({ profileId, profile: raw, adsPower: this.adsPower, loadAssets: false,
                    onSessionStatus: result => this.handleRestriction(profileId, result) });
                await this.handleRestriction(profileId, prepared.result);
                client = prepared.client;
                if (!client || !prepared.result.capabilities?.adsManager) throw Object.assign(new Error(prepared.result.message || "Не вдалося підготувати Ads Manager"),
                    { ...prepared.result, code: prepared.result.code ?? "ADS_MANAGER_SESSION_REQUIRED" });
            }
            // Зберігаємо сесію до читання активів, щоб помилка одного списку не втрачала авторизацію.
            await this.sessionStore.save(profileId, client.exportSession());
            let session = [...this.sessions.values()].find(item => item.profileId === profileId);
            if (!session) session = { id: `http-${randomUUID()}` };
            Object.assign(session, { profileNo: no, profileId, profile, client, phoneFlow: null,
                context: new HttpAdsManagerContext(client, profileId) });
            this.sessions.set(session.id, session);
            await this.overview(session);
            return this.publicSession(session);
        }); } finally { this.starting.delete(no); }
    }
    refreshSession = refreshProfileSession;
    restoreClient = (snapshot, options) => FacebookWebClient.restore(snapshot, options);
    addCreditCard = addCard;
    async overview(session) {
        const api = session.client.createGraphApi();
        const [accountsResult, pagesResult] = await Promise.allSettled([api.getAdAccounts(), api.getPages({ force: true })]);
        const accounts = accountsResult.status === "fulfilled" ? accountsResult.value : [];
        const adAccounts = [];
        for (const account of accounts) {
            try { adAccounts.push({ ...account, pixels: await api.getAdPixels(account.id) }); }
            catch { adAccounts.push({ ...account, pixels: [], pixelsError: "Не вдалося отримати пікселі" }); }
        }
        session.overview = { hasAccessToken: true, adAccounts,
            fanPages: pagesResult.status === "fulfilled" ? pagesResult.value.map(page => ({ pageId: page.id, name: page.name })) : [],
            fanPagesError: pagesResult.status === "rejected" ? "Не вдалося отримати фанпейджі; дивіться звіт" : null,
            adAccountsError: accountsResult.status === "rejected" ? "Не вдалося отримати РК; дивіться звіт" : null };
    }
    get(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) throw Object.assign(new Error("Сесію не знайдено. Запустіть перевірку профілю"), { code: "SESSION_NOT_FOUND" });
        return this.publicSession(session);
    }
    async execute(action, { sessionId, ...input } = {}) {
        const session = this.sessions.get(sessionId);
        if (!session) throw new Error("Спочатку запустіть і перевірте профіль");
        if (session.busy || this.starting.has(session.profileNo)) throw new Error("Дочекайтеся завершення попередньої дії");
        session.busy = true;
        try { return await this.reported(action, session.profileNo, async () => {
            session.context.failure = null;
            let value;
            try { value = await this.perform(action, session, input); }
            catch (error) {
                if (session.context.failure) {
                    session.context.failure.stage ??= error.stage;
                    error = session.context.failure;
                }
                await this.handleRestriction(session.profileId, error);
                if (error.sessionStatus) await this.sessionStore.remove(session.profileId).catch(() => {});
                throw error;
            }
            await this.handleRestriction(session.profileId, value);
            if (value?.sessionStatus === HUMAN_CONFIRMATION_REQUIRED) return value;
            try { await this.sessionStore.save(session.profileId, session.client.exportSession()); }
            catch {
                if (value && !Array.isArray(value)) return { ...value, storageWarning: "Дію виконано; не вдалося зберегти оновлену сесію" };
            }
            return value;
        }); } finally { session.busy = false; }
    }
    async perform(action, session, input) {
        const page = session.context;
        const options = { ...input, page, timeout: 60000 };
        switch (action) {
        case "overview": await this.overview(session); return this.publicSession(session);
        case "accounts": return session.client.createGraphApi().getAdAccounts();
        case "business.check": return checked(await getBusinessInfo(options));
        case "business.update": {
            const current = checked(await getBusinessInfo(options));
            const billing = checked(await checkBilling({ page, paymentAccountId: input.adAccountId }));
            const tax = billing.businessInfo || {};
            checked(await updateBusiness({ ...options, billableAccountPaymentLegacyAccountId: input.adAccountId,
                currency: input.currency || current.currency, timezone: input.timezone || current.timezone,
                tax: { ...input.tax, businessName: tax.businessName || current.businessName || input.tax?.businessName || "",
                    taxId: tax.taxId || "", secondTaxId: tax.secondTaxId || "", taxRegistrationStatus: tax.taxRegistrationStatus || "", isPersonalUse: tax.isPersonal ?? false } }));
            try {
                const refreshed = await getBusinessInfo(options);
                if (refreshed.success) return refreshed.data;
            } catch { /* Підтверджене оновлення не повторюємо через помилку контрольного читання. */ }
            return { ...current, ...input.tax?.businessAddress, currency: input.currency || current.currency,
                timezone: input.timezone || current.timezone, refreshError: "Дані оновлено; повторне читання не вдалося" };
        }
        case "payment.check": return checked(await getPaymentSources(options));
        case "payment.add": {
            const card = await this.creditCardStore.getForUse(input.cardId);
            const previousSignal = page.signal;
            page.signal = input.signal;
            try {
                const result = await this.addCreditCard(session.client, { profileId: session.profileId, adAccountId: input.adAccountId,
                    context: page, signal: input.signal, resourceHints: input.resourceHints, resources: input.resources,
                    card: { ...card, securityCode: String(input.securityCode || card.securityCode || "").trim() } });
                // Інші workflow отримують статус відмови та ID вже збереженої карти без втрати результату.
                const { exchanges, ...outcome } = result;
                if (result.sessionStatus) {
                    try { await this.sessionStore.remove?.(session.profileId); }
                    catch { outcome.storageWarning = "Не вдалося видалити неактуальну сесію; оновіть її перед наступною дією"; }
                }
                return { ...result.data, ...outcome };
            } finally { page.signal = previousSignal; }
        }
        case "phone.check": {
            const data = await page.graphql("SYDNUOWidgetContainerQuery", "40299379472978807", { adAccountID: input.adAccountId }, { __aaid: input.adAccountId });
            const task = data?.ad_account?.start_your_day_init_task_widgets?.find(item => item.taskType === "PHONE_NUMBER_VERIFICATION");
            return { adAccountId: input.adAccountId, phoneStatus: task?.completionStatus === "COMPLETE" ? "LINKED" : task?.completionStatus === "INCOMPLETE" ? "NOT_LINKED" : "UNKNOWN", completionStatus: task?.completionStatus || null };
        }
        case "phone.request": {
            const result = await requestPhoneCode({ ...options, locale: input.locale || "en_US" });
            const data = checked(result);
            session.phoneFlow = data.flow;
            return { status: result.status, phoneDisplay: data.flow?.phoneDisplay || input.phoneE164 };
        }
        case "phone.submit": {
            if (!session.phoneFlow) throw new Error("Спочатку надішліть код");
            const result = await submitPhoneCode({ ...options, flow: session.phoneFlow });
            checked(result);
            session.phoneFlow = null;
            return { status: result.status, phoneVerified: true, optionalConsentRequired: Boolean(result.optionalConsentRequired) };
        }
        case "pixels": return session.client.createGraphApi().getAdPixels(`act_${String(input.adAccountId).replace(/^act_/, "")}`);
        case "pixel.create": {
            if (!String(input.name || "").trim()) throw new Error("Вкажіть назву пікселя");
            return page.graph(`act_${String(input.adAccountId).replace(/^act_/, "")}/adspixels`, { name: input.name.trim() }, { mutation: true });
        }
        case "api.create": {
            if (session.apiCreated) return session.apiCreated;
            let baseName = String(input.name || "").trim();
            if (!baseName || !input.groupId) throw new Error("Вкажіть назву і групу");
            const card = input.cardId ? await this.creditCardStore.getForUse(input.cardId) : null;
            const account = await this.facebookAccountManager.create({
                ...session.client.getApiCredentials(session.client.getFbData(session.profileId)),
                name: card ? `${baseName} (${card.nickname} ${card.last4})` : baseName, adsPowerProfileNo: session.profileNo,
                autoPersonalName: input.autoName === true, personalNameSuffix: card ? ` (${card.nickname} ${card.last4})` : "",
            });
            if (input.autoName) baseName = `P${account.accountKey.match(/-(\d+)$/)[1]}`;
            let profileUpdateWarning = null;
            session.apiCreated = { account, adsPowerProfileName: session.profile.name, groupId: session.profile.groupId };
            try { await this.reloadFacebookBackend(); }
            catch { profileUpdateWarning = "API-клієнт збережено; оновіть список акаунтів"; }
            try {
                await this.adsPower.updateProfileName(session.profileId, baseName);
                session.profile.name = baseName;
                await this.adsPower.updateProfileGroup(session.profileId, input.groupId);
                session.profile.groupId = input.groupId;
            } catch { profileUpdateWarning = "API-клієнт створено; назву або групу AdsPower потрібно застосувати вручну"; }
            session.apiCreated = { account, adsPowerProfileName: session.profile.name, groupId: session.profile.groupId, profileUpdateWarning };
            return session.apiCreated;
        }
        case "disconnect": this.sessions.delete(session.id); return { disconnected: true };
        case "close": await this.adsPower.closeProfile(session.profileNo); this.sessions.delete(session.id); return { disconnected: true };
        default: throw new Error("Непідтримувана дія персонального автоаплоаду");
        }
    }
}
