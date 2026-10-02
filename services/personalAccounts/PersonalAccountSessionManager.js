import { randomUUID } from "node:crypto";

import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import captureGraphqlPayload from "../../facebook/api-actions/captureGraphqlPayload.js";
import createFanPage from "../../facebook/api-actions/pages/createFanPage.js";
import getFanPages from "../../facebook/api-actions/pages/getFanPages.js";
import getSwitchableFacebookProfiles
    from "../../facebook/api-actions/pages/getSwitchableFacebookProfiles.js";
import switchToAdditionalProfile from "../../facebook/api-actions/pages/switchToAdditionalProfile.js";
import confirmFacebookProfileSwitch
    from "../../facebook/workflows/confirmFacebookProfileSwitch.js";
import grantAdditionalProfileAccess
    from "../../facebook/workflows/grantAdditionalProfileAccess.js";
import checkBillingAccountInformation
    from "../../facebook/api-actions/ads-manager/checkBillingAccountInformation.js";
import updateBusinessInfo from "../../facebook/api-actions/ads-manager/updateBusinessInfo.js";
import addCreditCardPaymentMethod
    from "../../facebook/api-actions/ads-manager/addCreditCardPaymentMethod.js";
import getBrowserAdAccounts from "../../facebook/api-actions/ads-manager/getAdAccounts.js";
import getBrowserBusinessManagers from "../../facebook/api-actions/ads-manager/getBrowserBusinessManagers.js";
import requestAdAccountAccess from "../../facebook/api-actions/ads-manager/requestAdAccountAccess.js";
import getAdAccountAccessRequest from "../../facebook/api-actions/ads-manager/getAdAccountAccessRequest.js";
import listAdAccountAccessRequests from "../../facebook/api-actions/ads-manager/listAdAccountAccessRequests.js";
import acceptAdAccountAccessRequest from "../../facebook/api-actions/ads-manager/acceptAdAccountAccessRequest.js";
import rejectAdAccountAccessRequest from "../../facebook/api-actions/ads-manager/rejectAdAccountAccessRequest.js";
import getAdPixels from "../../facebook/api-actions/ads-manager/getAdPixels.js";
import createAdPixel from "../../facebook/api-actions/ads-manager/createAdPixel.js";
import requestPhoneVerificationCode
    from "../../facebook/api-actions/phone-verification/requestPhoneVerificationCode.js";
import submitPhoneVerificationCode
    from "../../facebook/api-actions/phone-verification/submitPhoneVerificationCode.js";
import {
    extractFacebookAccessTokenFromHtml,
} from "../../facebook/workflows/syncFacebookApiClientFromAdsPowerProfile.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";
import PersonalAccountSessionReport from "./PersonalAccountSessionReport.js";


const facebookUrl = "https://www.facebook.com/";
const profileUrl = "https://www.facebook.com/me";
const facebookGraphqlUrl = "https://www.facebook.com/api/graphql/";
const adsManagerUrl = "https://adsmanager.facebook.com/adsmanager/manage/campaigns";
const adsManagerGraphqlUrl = "https://adsmanager.facebook.com/api/graphql/";
const businessManagerSettingsUrl = "https://business.facebook.com/latest/settings";
const adAccountSettingsPath = "/adsmanager/manage/ad_account_settings/ad_account_setup";
const businessManagerGraphqlUrls = [
    "https://business.facebook.com/api/graphql/",
    "https://www.facebook.com/api/graphql/",
];
const billingPaymentSettingsPath = "/adsmanager/billing_hub/payment_settings/";
const personalAccountLaunchOptions = Object.freeze({
    browserMode: "visible",
    restoreLastOpenedTabs: false,
    proxyDetection: true,
});
const adsManagerSupplementalPayloadFields = Object.freeze([
    "av",
    "__user",
    "__a",
    "fb_dtsg",
    "jazoest",
    "lsd",
    "__comet_req",
    "__spin_r",
    "__spin_b",
    "__spin_t",
    "__crn",
]);
const billingPaymentRuntimeModules = [
    "BillingProtectedString",
    "BillingCreditCardUtils",
    "BillingSaveCardCredentialStateMutation.graphql",
    "BillingCheckRiskStateQuery.graphql",
    "BillingPTTUtils",
    "BillingPTTSharedUtils",
];
const billingCardRuntimeModules = [
    "BillingCreditCardTypes",
    "BillingCreditCardNumber",
];
const frontierPaymentCardModules = [
    "FrontierPMAmericanExpressCard",
    "FrontierPMDinersClubCard",
    "FrontierPMDiscoverCard",
    "FrontierPMJCBCard",
    "FrontierPMMastercardCard",
    "FrontierPMVisaCard",
];
const billingRuntimeModuleChunks = Object.freeze([
    {
        name: "BillingProtectedString",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4i-sZ4/yN/l/en_GB-j/_Xc03kAy42K.js",
        moduleNames: ["BillingProtectedString"],
    },
    {
        name: "FrontierPM card assets",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4iMLq4/y2/l/en_GB-j/hXHc1K_nBLw.js",
        moduleNames: frontierPaymentCardModules,
    },
    {
        name: "BillingCreditCardUtils",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4iSwq4/yu/l/en_GB-j/HAismX0HAm7.js",
        moduleNames: ["BillingCreditCardUtils"],
    },
    {
        name: "BillingSaveCardCredentialStateMutation.graphql",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4i3dl4/yH/l/en_GB-j/j2_ypcBNBxs.js",
        moduleNames: ["BillingSaveCardCredentialStateMutation.graphql"],
    },
    {
        name: "BillingCheckRiskStateQuery.graphql",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4i38S4/ys/l/en_GB-j/e50AF4rQD_S.js",
        moduleNames: ["BillingCheckRiskStateQuery.graphql"],
    },
]);
const billingIxAssets = Object.freeze({
    "883711": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        w: 30,
        h: 20,
        p: "0 0",
        sz: "auto",
    },
    "883713": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yn/r/4E6NHBwbnhe.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yn/r/4E6NHBwbnhe.webp",
        w: 30,
        h: 20,
        p: "0 -151px",
        sz: "auto",
    },
    "883715": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        w: 30,
        h: 20,
        p: "0 -21px",
        sz: "auto",
    },
    "883717": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        w: 30,
        h: 20,
        p: "0 -42px",
        sz: "auto",
    },
    "883719": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        w: 30,
        h: 20,
        p: "0 -63px",
        sz: "auto",
    },
    "883721": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        w: 30,
        h: 20,
        p: "0 -84px",
        sz: "auto",
    },
    "883723": {
        sprited: 2,
        spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        _spi: "https://static.xx.fbcdn.net/rsrc.php/yl/r/TLh2UkguiiB.webp",
        w: 30,
        h: 20,
        p: "0 -105px",
        sz: "auto",
    },
});


function isAdsManagerUrl(value) {
    try {
        const url = new URL(String(value ?? ""));
        return url.hostname.endsWith("facebook.com") && url.pathname.startsWith("/adsmanager");
    } catch {
        return false;
    }
}

// Доповнює Ads Manager payload лише полями, яких у ньому немає.
function supplementAdsManagerPayload(adsManagerPayload, facebookPayload) {
    const payload = { ...adsManagerPayload };
    for (const field of adsManagerSupplementalPayloadFields) {
        if (payload[field] !== undefined && payload[field] !== null) continue;
        if (facebookPayload?.[field] === undefined || facebookPayload[field] === null) continue;
        payload[field] = facebookPayload[field];
    }
    return payload;
}


function isConnectionRefused(error) {
    return error?.code === "ECONNREFUSED"
        || /\bECONNREFUSED\b/i.test(String(error?.message ?? error));
}


// Маскує пароль для діагностичного звіту, не розкриваючи його повністю.
function maskReauthCredential(value) {
    const credential = String(value ?? "");
    if (!credential) return null;
    if (credential.length < 3) return "***";
    return `${credential[0]}${"*".repeat(credential.length - 2)}${credential.at(-1)}`;
}


function sessionError(message, code, details = {}) {
    return Object.assign(new Error(message), { code, ...details });
}


function assertAction(result, fallback) {
    if (result?.success) return result;
    throw sessionError(
        result?.error || result?.facebookError?.description || result?.facebookError?.message || fallback,
        result?.status || "PERSONAL_ACCOUNT_ACTION_FAILED",
        {
            stage: result?.stage ?? null,
            httpStatus: result?.httpStatus ?? null,
            graphCode: result?.graphCode ?? null,
            graphSubcode: result?.graphSubcode ?? null,
            facebookError: result?.facebookError ?? null,
        }
    );
}


function publicSession(session) {
    return {
        id: session.id,
        profileNo: session.profileNo,
        profileId: session.profileId,
        profileName: session.profileName,
        context: session.context,
        actorId: session.actorId,
        mainActorId: session.mainActorId,
        pageId: session.pageId,
        additionalProfileId: session.additionalProfileId,
        hasAccessToken: Boolean(session.accessToken),
        hasBusinessManagerPayload: Boolean(session.businessManagerPayload),
        hasPhoneFlow: Boolean(session.phoneFlow),
        overview: session.overview ?? null,
        connected: Boolean(session.browser?.connected),
        reportPath: session.report.file,
        createdAt: session.createdAt,
    };
}


function publicResult(result) {
    return {
        success: result.success,
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
        ...(result.httpStatus ? { httpStatus: result.httpStatus } : {}),
        ...(result.moduleName ? { moduleName: result.moduleName } : {}),
        ...(result.failureStage ? { failureStage: result.failureStage } : {}),
        ...(result.moduleDiagnostics ? { moduleDiagnostics: result.moduleDiagnostics } : {}),
        ...(result.pageContext ? { pageContext: result.pageContext } : {}),
        ...(result.contextDiagnostics ? { contextDiagnostics: result.contextDiagnostics } : {}),
        ...(result.billingDiagnostics ? { billingDiagnostics: result.billingDiagnostics } : {}),
    };
}


export default class PersonalAccountSessionManager {
    #sessions = new Map();


    constructor({
        adsPower,
        creditCardStore,
        facebookAccountManager,
        reloadFacebookBackend = async () => {},
        reportsDirectory,
        logger = null,
        mode = "personal",
    } = {}) {
        this.adsPower = adsPower;
        this.creditCardStore = creditCardStore;
        this.facebookAccountManager = facebookAccountManager;
        this.reloadFacebookBackend = reloadFacebookBackend;
        this.reportsDirectory = reportsDirectory;
        this.logger = logger;
        this.mode = mode;
    }


    async start({ profileNo }) {
        const normalizedProfileNo = String(profileNo ?? "").trim();
        if (!/^\d+$/.test(normalizedProfileNo)) {
            throw sessionError("Потрібен номер AdsPower-профілю", "PROFILE_NO_REQUIRED");
        }
        for (const active of this.#sessions.values()) {
            if (active.profileNo !== normalizedProfileNo) continue;
            if (active.browser?.connected) return this.refresh(active.id);
            await this.#reconnect(active);
            return this.refresh(active.id);
        }

        const profile = await this.adsPower.getProfileByNo(normalizedProfileNo);
        if (!await ensureAdsPowerProfileReady(this.adsPower, profile)) {
            throw sessionError("AdsPower-профіль не готовий до запуску", "PROFILE_NOT_READY");
        }

        const id = randomUUID();
        const report = new PersonalAccountSessionReport({
            reportsDirectory: this.reportsDirectory,
            sessionId: id,
            profileNo: normalizedProfileNo,
        });
        let browser;
        let opened = false;
        try {
            await report.append("session.starting", { profileName: profile.name ?? "" });
            const browserData = await this.adsPower.openProfile(
                normalizedProfileNo,
                personalAccountLaunchOptions
            );
            opened = true;
            browser = await puppeteer.connect({
                browserWSEndpoint: browserData.ws.puppeteer,
                defaultViewport: null,
            });
            const page = await browser.newPage();
            await configureFacebookAutomationWindow(page, { browserMode: "visible" });
            await openPageWithoutPopups(page, facebookUrl, { timeout: 60000 });
            if (!await ensureFacebookAccountLoggedIn(this.adsPower, profile, page)) {
                throw sessionError("Facebook-вхід не підтверджено", "FACEBOOK_NOT_LOGGED_IN");
            }
            if (!await ensureFacebookAccountActive(this.adsPower, profile, page)) {
                throw sessionError("Facebook-профіль неактивний", "FACEBOOK_NOT_ACTIVE");
            }
            if (!await ensureEnglish(page)) {
                throw sessionError("Не вдалося перемкнути Facebook на English", "FACEBOOK_ENGLISH_FAILED");
            }
            const captured = assertAction(
                await captureGraphqlPayload(page, { profileUrl, timeout: 60000 }),
                "Не вдалося отримати Facebook payload"
            );
            const session = {
                id,
                profileNo: normalizedProfileNo,
                profileId: String(profile.profile_id ?? ""),
                profileName: String(profile.name ?? profile.username ?? ""),
                profile,
                browser,
                page,
                wsEndpoint: browserData.ws.puppeteer,
                opened,
                context: "FACEBOOK_MAIN",
                payload: captured.data,
                facebookPayload: captured.data,
                payloadUrl: page.url(),
                actorId: String(captured.data.__user ?? ""),
                mainActorId: String(captured.data.__user ?? ""),
                pageId: null,
                additionalProfileId: null,
                accessToken: "",
                businessManagerPayload: null,
                addAccountSettingsPayload: null,
                addAccountSettingsPayloadUrl: "",
                fanPages: [],
                overview: null,
                phoneFlow: null,
                operation: Promise.resolve(),
                report,
                createdAt: new Date().toISOString(),
            };
            this.#sessions.set(id, session);
            await this.#refreshOverview(session);
            await report.append("session.started", {
                actorId: session.actorId,
                context: session.context,
            });
            this.logger?.info("session.started", "Запущено сесію персонального акаунта", {
                sessionId: id,
                profileNo: normalizedProfileNo,
            });
            return publicSession(session);
        } catch (error) {
            await report.append("session.start_failed", { error }).catch(() => {});
            try { browser?.disconnect(); } catch {}
            if (opened) await this.adsPower.closeProfile(normalizedProfileNo).catch(() => {});
            throw error;
        }
    }


    get(sessionId) {
        return publicSession(this.#require(sessionId));
    }

    hasActiveProfile(profileNo) {
        return [...this.#sessions.values()].some((session) => session.profileNo === String(profileNo) && session.browser?.connected);
    }

    refresh(sessionId) {
        return this.#perform(sessionId, "session.refresh", async (session) => {
            session.payload = null;
            session.payloadUrl = "";
            session.facebookPayload = null;
            session.businessManagerPayload = null;
            session.addAccountSettingsPayload = null;
            session.addAccountSettingsPayloadUrl = "";
            session.accessToken = "";
            session.overview = null;
            session.fanPages = [];
            await openPageWithoutPopups(session.page, facebookUrl, { timeout: 60000 });
            if (!await ensureFacebookAccountLoggedIn(this.adsPower, session.profile, session.page)) {
                throw sessionError("Facebook-вхід не підтверджено", "FACEBOOK_NOT_LOGGED_IN");
            }
            if (!await ensureFacebookAccountActive(this.adsPower, session.profile, session.page)) {
                throw sessionError("Facebook-профіль неактивний", "FACEBOOK_NOT_ACTIVE");
            }
            if (!await ensureEnglish(session.page)) {
                throw sessionError("Не вдалося перемкнути Facebook на English", "FACEBOOK_ENGLISH_FAILED");
            }
            await this.#capture(session, profileUrl, "FACEBOOK_MAIN");
            await this.#ensureAdsManager(session);
            await this.#refreshOverview(session);
            return publicSession(session);
        });
    }

    listBusinessManagers(sessionId) {
        return this.#perform(sessionId, "business.managers_list", async (session) => {
            if (this.mode !== "businessManager") throw sessionError("Потрібна сесія БМ", "BUSINESS_SESSION_REQUIRED");
            await this.#ensureAccessToken(session);
            return assertAction(await getBrowserBusinessManagers({
                page: session.page, accessToken: session.accessToken,
            }), "Не вдалося отримати список бізнес-менеджерів").data;
        });
    }

    requestAdAccountAccess(sessionId, { businessId, adAccountId }) {
        return this.#perform(sessionId, "ads.access_request", async (session) => {
            await session.report.append("ads.access_request.request", {
                method: "POST",
                businessId,
                adAccountId,
            });
            if (this.mode !== "businessManager") throw sessionError("Потрібна сесія БМ", "BUSINESS_SESSION_REQUIRED");
            if (!/^\d+$/.test(String(businessId)) || !/^\d+$/.test(String(adAccountId).replace(/^act_/, ""))) {
                throw sessionError("Некоректний ID бізнесу або РК", "INVALID_INPUT");
            }
            const target = `${businessManagerSettingsUrl}/ad_accounts?business_id=${businessId}`;
            const current = session.page.url();
            if (current !== target || !session.businessManagerPayload || session.businessManagerPayloadUrl !== current) {
                const captured = assertAction(await captureGraphqlPayload(session.page, {
                    profileUrl: target, graphqlUrl: businessManagerGraphqlUrls, timeout: 60000,
                }), "Не вдалося отримати payload налаштувань БМ");
                session.businessManagerPayload = captured.data;
                session.businessManagerPayloadUrl = session.page.url();
            }
            const result = await requestAdAccountAccess({
                page: session.page, businessId, adAccountId,
            });
            await session.report.append("ads.access_request.response", {
                status: result.status,
                httpStatus: result.httpStatus ?? null,
                error: result.error ?? null,
                graphCode: result.graphCode ?? null,
                graphSubcode: result.graphSubcode ?? null,
            });
            return assertAction(result, "Не вдалося надіслати запит на доступ до РК").data;
        });
    }

    prepareAdAccountAccess(sessionId, { adAccountId }) {
        return this.#perform(sessionId, "ads.access_prepare", async (session) => {
            if (this.mode === "businessManager") throw sessionError("Потрібен персональний профіль", "PERSONAL_SESSION_REQUIRED");
            const accountId = String(adAccountId ?? "").replace(/^act_/, "");
            if (!/^\d+$/.test(accountId)) throw sessionError("Некоректний ID РК", "INVALID_INPUT");
            const target = `https://adsmanager.facebook.com${adAccountSettingsPath}?act=${accountId}`;
            if (session.page.url() !== target || session.addAccountSettingsPayloadUrl !== target) {
                const captured = assertAction(await captureGraphqlPayload(session.page, {
                    profileUrl: target, graphqlUrl: adsManagerGraphqlUrl, timeout: 60000,
                }), "Не вдалося отримати Add Account Settings payload");
                session.addAccountSettingsPayload = captured.data;
                session.addAccountSettingsPayloadUrl = session.page.url();
                session.payload = supplementAdsManagerPayload(captured.data, session.facebookPayload);
                session.payloadUrl = session.page.url();
                session.actorId = String(session.payload.__user ?? "");
                session.context = "ADS_MANAGER";
            }
            return { ready: Boolean(session.addAccountSettingsPayload) };
        });
    }

    findAdAccountAccessRequest(sessionId, input) {
        return this.#perform(sessionId, "ads.access_find", async (session) => {
            await session.report.append("ads.access_find.request", {
                method: "GET",
                path: "/adaccount/agency/accept_reject_dialog/",
                adAccountId: input?.adAccountId,
                agencyId: input?.agencyId,
                adMarketId: input?.adMarketId,
            });
            if (this.mode === "businessManager" || !session.addAccountSettingsPayload
                || session.addAccountSettingsPayloadUrl !== session.page.url()) {
                throw sessionError("Спочатку відкрийте налаштування РК", "ACCOUNT_SETTINGS_REQUIRED");
            }
            const result = await getAdAccountAccessRequest({ page: session.page, ...input });
            await session.report.append("ads.access_find.response", {
                status: result.status,
                httpStatus: result.httpStatus ?? null,
                facebookError: result.facebookError ?? null,
                hasAccept: Boolean(result.data?.accept),
                hasReject: Boolean(result.data?.reject),
                error: result.error ?? null,
            });
            return assertAction(result, "Не вдалося перевірити запрошення");
        });
    }

    listAdAccountAccessRequests(sessionId, { adAccountId }) {
        return this.#perform(sessionId, "ads.access_list", async (session) => {
            if (this.mode === "businessManager" || !session.addAccountSettingsPayload
                || session.addAccountSettingsPayloadUrl !== session.page.url()) {
                throw sessionError("Спочатку відкрийте налаштування РК", "ACCOUNT_SETTINGS_REQUIRED");
            }
            const listed = assertAction(await listAdAccountAccessRequests({ page: session.page, adAccountId }),
                "Не вдалося отримати список запрошень").data;
            await session.report.append("ads.access_list.candidates", {
                adAccountId, candidates: listed,
            });
            const invites = [];
            const errors = [];
            for (const candidate of listed) {
                const result = await getAdAccountAccessRequest({ page: session.page, ...candidate });
                await session.report.append("ads.access_list.response", {
                    adAccountId: candidate.adAccountId,
                    agencyId: candidate.agencyId,
                    adMarketId: candidate.adMarketId,
                    status: result.status,
                    httpStatus: result.httpStatus ?? null,
                    facebookError: result.facebookError ?? null,
                    hasAccept: Boolean(result.data?.accept),
                    hasReject: Boolean(result.data?.reject),
                    error: result.error ?? null,
                });
                if (result.success && result.status === "FOUND") invites.push(result.data);
                else if (!result.success) errors.push({
                    ...candidate,
                    status: result.status,
                    message: result.error || result.facebookError?.description
                        || result.facebookError?.message || result.status,
                });
            }
            return { invites, errors };
        });
    }

    acceptAdAccountAccessRequest(sessionId, invite) {
        return this.#perform(sessionId, "ads.access_accept", async (session) => {
            await session.report.append("ads.access_accept.request", {
                method: "POST",
                path: "/adaccount/agency/request/accept_reject/",
                adAccountId: invite?.adAccountId,
                agencyId: invite?.agencyId,
                adMarketId: invite?.adMarketId,
                operation: "0",
                hasExt: Boolean(invite?.accept?.ext),
                hasHash: Boolean(invite?.accept?.hash),
            });
            if (this.mode === "businessManager" || !session.addAccountSettingsPayload
                || session.addAccountSettingsPayloadUrl !== session.page.url()) {
                throw sessionError("Спочатку відкрийте налаштування РК", "ACCOUNT_SETTINGS_REQUIRED");
            }
            const result = await acceptAdAccountAccessRequest({ page: session.page, invite });
            await session.report.append("ads.access_accept.response", {
                status: result.status,
                httpStatus: result.httpStatus ?? null,
                facebookError: result.facebookError ?? null,
                error: result.error ?? null,
            });
            return assertAction(result, "Не вдалося прийняти запрошення").data;
        });
    }

    rejectAdAccountAccessRequest(sessionId, invite) {
        return this.#perform(sessionId, "ads.access_reject", async (session) => {
            await session.report.append("ads.access_reject.request", {
                method: "POST",
                path: "/adaccount/agency/request/accept_reject/",
                adAccountId: invite?.adAccountId,
                agencyId: invite?.agencyId,
                adMarketId: invite?.adMarketId,
                operation: "1",
                hasExt: Boolean(invite?.reject?.ext),
                hasHash: Boolean(invite?.reject?.hash),
            });
            if (this.mode === "businessManager" || !session.addAccountSettingsPayload
                || session.addAccountSettingsPayloadUrl !== session.page.url()) {
                throw sessionError("Спочатку відкрийте налаштування РК", "ACCOUNT_SETTINGS_REQUIRED");
            }
            const result = await rejectAdAccountAccessRequest({ page: session.page, invite });
            await session.report.append("ads.access_reject.response", {
                status: result.status,
                httpStatus: result.httpStatus ?? null,
                facebookError: result.facebookError ?? null,
                error: result.error ?? null,
            });
            return assertAction(result, "Не вдалося відхилити запрошення").data;
        });
    }


    createFanPage(sessionId, input) {
        return this.#perform(sessionId, "fanpage.create", async (session) => {
            await this.#ensureFacebookContext(session, session.mainActorId, profileUrl, "FACEBOOK_MAIN");
            const result = assertAction(await createFanPage({
                page: session.page,
                commonPayload: session.payload,
                name: input.name,
                categoryId: input.categoryId || undefined,
                bio: input.bio ?? "",
                timeout: 60000,
            }), "Не вдалося створити фанпейдж");
            session.pageId = String(result.pageId);
            session.additionalProfileId = String(result.additionalProfileId ?? "");
            const profiles = await this.#getSwitchableProfiles(session);
            return {
                status: result.status,
                pageId: session.pageId,
                additionalProfileId: session.additionalProfileId,
                profiles,
                session: publicSession(session),
            };
        });
    }


    switchToFanPage(sessionId, input = {}) {
        return this.#perform(sessionId, "fanpage.switch", async (session) => {
            const additionalProfileId = String(
                input.additionalProfileId ?? session.additionalProfileId ?? ""
            ).trim();
            if (!additionalProfileId) {
                throw sessionError("Потрібен Additional profile ID", "ADDITIONAL_PROFILE_ID_REQUIRED");
            }
            await this.#ensureFacebookContext(session, session.mainActorId, profileUrl, "FACEBOOK_MAIN");
            const startedAt = Date.now();
            await session.report.append("fanpage.switch.mutation_started", {
                startedAt: new Date(startedAt).toISOString(),
                context: session.context,
            });
            let switchResult;
            try {
                switchResult = assertAction(await switchToAdditionalProfile({
                    page: session.page,
                    commonPayload: session.payload,
                    additionalProfileId,
                    timeout: 60000,
                }), "Не вдалося перемкнутися на фанпейдж");
            } catch (error) {
                await session.report.append("fanpage.switch.mutation_failed", {
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - startedAt,
                    error: String(error?.message ?? error),
                });
                throw error;
            }
            await session.report.append("fanpage.switch.mutation_completed", {
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAt,
                context: session.context,
            });
            session.additionalProfileId = additionalProfileId;
            session.payload = null;
            session.context = "FACEBOOK_SWITCH_REQUESTED";
            const confirmationStartedAt = Date.now();
            await session.report.append("fanpage.switch.confirmation_started", {
                startedAt: new Date(confirmationStartedAt).toISOString(),
                targetProfileId: additionalProfileId,
            });
            let confirmed;
            try {
                confirmed = assertAction(await confirmFacebookProfileSwitch({
                    page: session.page,
                    targetProfileId: additionalProfileId,
                    profileUrl,
                    timeout: 60000,
                }), "Не вдалося підтвердити перемикання Facebook actor");
            } catch (error) {
                await session.report.append("fanpage.switch.confirmation_failed", {
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - confirmationStartedAt,
                    targetProfileId: additionalProfileId,
                    error: String(error?.message ?? error),
                });
                throw error;
            }
            session.payload = confirmed.data.payload;
            session.payloadUrl = session.page.url();
            session.actorId = confirmed.data.actorId;
            session.context = "FACEBOOK_ADDITIONAL_PROFILE";
            await session.report.append("fanpage.switch.confirmed", {
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - confirmationStartedAt,
                actorId: session.actorId,
                targetProfileId: additionalProfileId,
            });
            const profiles = await this.#getSwitchableProfiles(session);
            await session.report.append("fanpage.switch.profiles_refreshed", {
                completedAt: new Date().toISOString(),
                count: profiles.length,
                actorId: session.actorId,
            });
            return {
                status: confirmed.status,
                mutationStatus: switchResult.status,
                additionalProfileId,
                profiles,
                session: publicSession(session),
            };
        });
    }


    grantFanPageAccess(sessionId, input = {}) {
        return this.#perform(sessionId, "fanpage.access_grant", async (session) => {
            const targetUserId = String(input.targetUserId ?? "").trim();
            const credential = String(session.profile?.password ?? "");
            if (!/^\d+$/.test(targetUserId)) {
                throw sessionError(
                    "Потрібен числовий Facebook User ID отримувача",
                    "TARGET_USER_ID_REQUIRED"
                );
            }
            if (!credential) {
                throw sessionError(
                    "У профілі AdsPower відсутній пароль Facebook для повторної авторизації",
                    "FACEBOOK_PASSWORD_REQUIRED"
                );
            }

            // Використовує поточний Facebook actor або отримує свіжий payload після переходу на /me.
            await this.#ensureFacebookContext(
                session,
                "",
                profileUrl,
                "FACEBOOK_CURRENT"
            );
            const additionalProfileId = String(
                session.payload?.__user ?? session.actorId ?? ""
            ).trim();

            // Фіксує лише безпечні ознаки вхідних даних для діагностики reauth.
            await session.report.append("fanpage.access_grant.diagnostics", {
                requestedTargetUserId: targetUserId,
                requestedTargetUserIdIsNumeric: true,
                sessionActorId: session.actorId || null,
                sessionMainActorId: session.mainActorId || null,
                sessionAdditionalProfileId: session.additionalProfileId || null,
                sessionContext: session.context || null,
                payloadAdditionalProfileId: additionalProfileId || null,
                payloadAdditionalProfileIdIsNumeric: /^\d+$/.test(additionalProfileId),
                reauthCredentialPresent: true,
                reauthCredentialLength: credential.length,
                reauthCredentialPreview: maskReauthCredential(credential),
            });
            if (!/^\d+$/.test(additionalProfileId)) {
                throw sessionError(
                    "Не вдалося визначити поточну фанпейджу з Facebook payload",
                    "ADDITIONAL_PROFILE_ID_REQUIRED"
                );
            }
            const commonPayload = {
                ...session.payload,
                // DevTools-виклик Facebook використовує поточний Additional Profile як av.
                av: additionalProfileId,
            };
            await session.report.append("fanpage.access_grant.context_verified", {
                additionalProfileId,
                actorId: session.actorId || null,
                actorMatchesAdditionalProfile: session.actorId === additionalProfileId,
                payloadUserId: String(commonPayload.__user ?? "") || null,
                payloadUserMatchesAdditionalProfile: String(commonPayload.__user ?? "") === additionalProfileId,
                payloadAv: String(commonPayload.av ?? "") || null,
                payloadAvMatchesAdditionalProfile: String(commonPayload.av ?? "") === additionalProfileId,
            });
            const result = assertAction(await grantAdditionalProfileAccess({
                page: session.page,
                commonPayload,
                additionalProfileId,
                targetUserId,
                password: credential,
                timeout: 60000,
            }), "Не вдалося надати доступ до фанпейджа");
            session.payload = null;
            return {
                ...publicResult(result),
                additionalProfileId,
                targetUserId: String(input.targetUserId ?? ""),
                reauthStatus: result.reauthStatus ?? null,
            };
        });
    }


    listAdAccounts(sessionId) {
        return this.#perform(sessionId, "ads.accounts_list", async (session) => {
            await this.#ensureAccessToken(session);
            const result = assertAction(await getBrowserAdAccounts({
                page: session.page,
                accessToken: session.accessToken,
            }), "Не вдалося отримати рекламні акаунти");
            return result.data;
        });
    }


    listFanPages(sessionId) {
        return this.#perform(sessionId, "fanpage.list", async (session) => {
            await this.#refreshOverview(session);
            return session.overview.fanPages;
        });
    }


    listSwitchableFacebookProfiles(sessionId) {
        return this.#perform(sessionId, "fanpage.switchable_profiles_list", async (session) => (
            this.#getSwitchableProfiles(session)
        ));
    }


    refreshOverview(sessionId) {
        return this.#perform(sessionId, "overview.refresh", async (session) => {
            await this.#refreshOverview(session);
            return publicSession(session);
        });
    }


    checkBusinessInfo(sessionId, input) {
        return this.#perform(sessionId, "ads.business_info_check", async (session) => {
            await this.#ensureAdsManager(session, input.adAccountId);
            const result = assertAction(await checkBillingAccountInformation({
                page: session.page,
                commonPayload: session.payload,
                paymentAccountId: input.adAccountId,
                timeout: 60000,
            }), "Не вдалося перевірити business info");
            return result.data;
        });
    }


    updateBusinessInfo(sessionId, input) {
        return this.#perform(sessionId, "ads.business_info_update", async (session) => {
            await this.#ensureAdsManager(session, input.adAccountId);
            const result = assertAction(await updateBusinessInfo({
                page: session.page,
                commonPayload: session.payload,
                billableAccountPaymentLegacyAccountId: input.adAccountId,
                currency: input.currency ?? "USD",
                timezone: input.timezone ?? "Europe/Kiev",
                deviceCountry: input.deviceCountry ?? null,
                tax: input.tax ?? {},
                timeout: 60000,
            }), "Не вдалося оновити business info");
            return result.data?.businessInfo ?? result.data;
        });
    }


    addCreditCard(sessionId, input) {
        return this.#perform(sessionId, "ads.card_add", async (session) => {
            await this.#ensureAdsManager(session, input.adAccountId);
            await this.#ensureBillingPaymentSettings(session, input.adAccountId);
            const card = await this.creditCardStore.getForUse(input.cardId);
            const result = await addCreditCardPaymentMethod({
                page: session.page,
                paymentAccountId: input.adAccountId,
                cardNumber: card.cardNumber,
                securityCode: input.securityCode,
                expiration: card.expiration,
                cardholderName: card.cardholderName,
                postalCode: card.postalCode,
                countryCode: card.countryCode,
                timeout: 60000,
            });
            if (!result.success) {
                throw sessionError(
                    result.error || `Meta не додала карту: ${result.status}`,
                    result.status,
                    { stage: "ADD_CARD", result: publicResult(result) }
                );
            }
            return { ...result.data, cardId: card.id, nickname: card.nickname };
        });
    }


    requestPhoneCode(sessionId, input) {
        return this.#perform(sessionId, "ads.phone_code_request", async (session) => {
            await this.#ensureAdsManager(session, input.adAccountId);
            await this.#ensureBillingPagePayload(session, input.adAccountId);
            const result = assertAction(await requestPhoneVerificationCode({
                page: session.page,
                commonPayload: session.payload,
                adAccountId: input.adAccountId,
                phoneE164: input.phoneE164,
                countryCode: input.countryCode,
                locale: input.locale ?? "en_US",
                method: input.method,
                timeout: 60000,
            }), "Не вдалося надіслати код підтвердження");
            session.phoneFlow = result.data.flow;
            return {
                status: result.status,
                phoneDisplay: result.data.flow?.phoneDisplay ?? input.phoneE164,
            };
        });
    }


    submitPhoneCode(sessionId, input) {
        return this.#perform(sessionId, "ads.phone_code_submit", async (session) => {
            if (!session.phoneFlow) {
                throw sessionError("Спочатку надішліть код підтвердження", "PHONE_FLOW_REQUIRED");
            }
            await this.#ensureAdsManager(session, session.phoneFlow.adAccountId);
            await this.#ensureBillingPagePayload(session, session.phoneFlow.adAccountId);
            const result = assertAction(await submitPhoneVerificationCode({
                page: session.page,
                commonPayload: session.payload,
                flow: session.phoneFlow,
                code: input.code,
                timeout: 60000,
            }), "Не вдалося підтвердити код");
            session.phoneFlow = null;
            return { status: result.status, phoneVerified: true };
        });
    }


    listPixels(sessionId, input) {
        return this.#perform(sessionId, "ads.pixels_list", async (session) => {
            await this.#ensureAccessToken(session);
            const result = assertAction(await getAdPixels({
                page: session.page,
                accessToken: session.accessToken,
                adAccountId: input.adAccountId,
                timeout: 60000,
            }), "Не вдалося отримати пікселі");
            return result.data;
        });
    }


    createPixel(sessionId, input) {
        return this.#perform(sessionId, "ads.pixel_create", async (session) => {
            await this.#ensureAccessToken(session);
            const result = assertAction(await createAdPixel({
                page: session.page,
                accessToken: session.accessToken,
                adAccountId: input.adAccountId,
                name: input.name,
                timeout: 60000,
            }), "Не вдалося створити піксель");
            return result.data;
        });
    }


    createApiProfile(sessionId, input) {
        return this.#perform(sessionId, "api_profile.create", async (session) => {
            await this.#ensureAccessToken(session);
            const card = input.cardId
                ? await this.creditCardStore.getForUse(input.cardId)
                : null;
            const baseName = String(input.name ?? "").trim();
            if (!baseName) throw sessionError("Вкажіть назву API-профілю", "API_PROFILE_NAME_REQUIRED");
            const name = card
                ? `${baseName} (${card.nickname} ${card.last4})`
                : baseName;
            const [userAgent, cookies] = await Promise.all([
                session.page.evaluate(() => navigator.userAgent),
                session.page.cookies("https://www.facebook.com"),
            ]);
            const account = await this.facebookAccountManager.create({
                name,
                adsPowerProfileNo: session.profileNo,
                userAgent,
                accessToken: session.accessToken,
                cookie: cookies,
            });
            await this.reloadFacebookBackend();
            if (session.profileId) {
                await this.adsPower.updateProfileName(session.profileId, baseName);
                session.profileName = baseName;
            }
            return { account, adsPowerProfileName: baseName };
        });
    }


    disconnect(sessionId) {
        return this.#detach(sessionId);
    }


    closeProfile(sessionId) {
        return this.#finish(sessionId, true);
    }


    async disconnectAll() {
        await Promise.all([...this.#sessions.keys()].map((id) => this.#detach(id)));
    }


    #getSession(sessionId) {
        const session = this.#sessions.get(String(sessionId));
        if (!session) throw sessionError("Сесію персонального акаунта не знайдено", "SESSION_NOT_FOUND");
        return session;
    }


    #require(sessionId) {
        const session = this.#getSession(sessionId);
        if (!session.browser?.connected || !session.page) {
            throw sessionError(
                "Puppeteer відключений. Відкрийте персональний акаунт повторно",
                "SESSION_DISCONNECTED"
            );
        }
        return session;
    }


    async #reconnect(session) {
        await session.operation.catch(() => {});
        await session.report.append("session.reconnecting", {});
        let browser;
        let startedNewProfile = false;
        try {
            try {
                browser = await puppeteer.connect({
                    browserWSEndpoint: session.wsEndpoint,
                    defaultViewport: null,
                });
            } catch (error) {
                if (!isConnectionRefused(error)) throw error;
                await session.report.append("session.websocket_stale", {});
                const browserData = await this.adsPower.openProfile(
                    session.profileNo,
                    personalAccountLaunchOptions
                );
                session.wsEndpoint = browserData.ws.puppeteer;
                browser = await puppeteer.connect({
                    browserWSEndpoint: session.wsEndpoint,
                    defaultViewport: null,
                });
                startedNewProfile = true;
            }
            const pages = startedNewProfile ? [] : await browser.pages();
            const page = startedNewProfile
                ? await browser.newPage()
                : (pages.find((item) => item.url().includes("facebook.com"))
                    ?? pages[0]
                    ?? await browser.newPage());
            session.browser = browser;
            session.page = page;
            await configureFacebookAutomationWindow(page, { browserMode: "visible" });
            await openPageWithoutPopups(page, facebookUrl, { timeout: 60000 });
            if (!await ensureFacebookAccountLoggedIn(this.adsPower, session.profile, page)) {
                throw sessionError("Facebook-вхід не підтверджено", "FACEBOOK_NOT_LOGGED_IN");
            }
            if (!await ensureFacebookAccountActive(this.adsPower, session.profile, page)) {
                throw sessionError("Facebook-профіль неактивний", "FACEBOOK_NOT_ACTIVE");
            }
            if (!await ensureEnglish(page)) {
                throw sessionError("Не вдалося перемкнути Facebook на English", "FACEBOOK_ENGLISH_FAILED");
            }
            await this.#ensureFacebookContext(
                session,
                session.mainActorId,
                profileUrl,
                "FACEBOOK_MAIN"
            );
            await session.report.append("session.reconnected", {
                actorId: session.actorId,
                context: session.context,
            });
            return publicSession(session);
        } catch (error) {
            try { browser?.disconnect(); } catch {}
            session.browser = null;
            session.page = null;
            await session.report.append("session.reconnect_failed", { error }).catch(() => {});
            throw error;
        }
    }


    #perform(sessionId, action, operation) {
        const session = this.#require(sessionId);
        const execute = async () => {
            const startedAt = Date.now();
            await session.report.append(`${action}.started`, { context: session.context });
            try {
                const result = await operation(session);
                await session.report.append(`${action}.completed`, {
                    durationMs: Date.now() - startedAt,
                    context: session.context,
                    result: (action === "ads.access_find" || action === "ads.access_list") ? {
                        success: result.success,
                        status: result.status ?? null,
                        httpStatus: result.httpStatus ?? null,
                        hasAccept: Boolean(result.data?.accept),
                        hasReject: Boolean(result.data?.reject),
                        inviteCount: result.invites?.length ?? null,
                        errorCount: result.errors?.length ?? null,
                    } : result,
                });
                this.logger?.info(action, "Дію персонального акаунта виконано", {
                    sessionId: session.id,
                    profileNo: session.profileNo,
                    durationMs: Date.now() - startedAt,
                });
                return result;
            } catch (error) {
                await session.report.append(`${action}.failed`, {
                    durationMs: Date.now() - startedAt,
                    context: session.context,
                    error: {
                        name: error?.name ?? "Error",
                        message: String(error?.message ?? error),
                        code: error?.code ?? null,
                        stage: error?.stage ?? null,
                        httpStatus: error?.httpStatus ?? null,
                        facebookError: error?.facebookError ?? null,
                        ...(error?.result ? { result: error.result } : {}),
                        ...(error?.moduleName ? { moduleName: error.moduleName } : {}),
                        ...(error?.stack ? { stack: error.stack } : {}),
                    },
                }).catch(() => {});
                this.logger?.error(`${action}.failed`, "Дія персонального акаунта завершилася помилкою", {
                    sessionId: session.id,
                    profileNo: session.profileNo,
                    error,
                });
                throw error;
            }
        };
        const result = session.operation.then(execute, execute);
        session.operation = result.catch(() => {});
        return result;
    }


    // Оновлює payload поточного Facebook actor, не перемикаючи профіль заради списку.
    async #getSwitchableProfiles(session) {
        const hasCurrentFacebookPayload = Boolean(session.payload)
            && Boolean(session.payloadUrl)
            && !isAdsManagerUrl(session.payloadUrl)
            && session.payloadUrl === session.page.url();
        if (!hasCurrentFacebookPayload) {
            await this.#capture(session, profileUrl, "FACEBOOK_CURRENT");
        }
        const result = assertAction(await getSwitchableFacebookProfiles({
            page: session.page,
            commonPayload: session.payload,
            timeout: 60000,
        }), "Не вдалося отримати доступні для перемикання профілі");
        return result.data;
    }


    // Формує єдиний read-only знімок для огляду без повторного збереження payload чи token.
    async #refreshOverview(session) {
        await this.#ensureAccessToken(session);
        const [fanPagesResult, accountsResult] = await Promise.allSettled([
            getFanPages({ page: session.page, accessToken: session.accessToken, timeout: 60000 }),
            getBrowserAdAccounts({ page: session.page, accessToken: session.accessToken, timeout: 60000 }),
        ]);
        const fanPagesResponse = fanPagesResult.status === "fulfilled"
            ? fanPagesResult.value
            : { success: false, error: String(fanPagesResult.reason?.message ?? fanPagesResult.reason) };
        const accountsResponse = accountsResult.status === "fulfilled"
            ? accountsResult.value
            : { success: false, error: String(accountsResult.reason?.message ?? accountsResult.reason) };
        const fanPages = fanPagesResponse.success && Array.isArray(fanPagesResponse.data)
            ? fanPagesResponse.data
            : [];
        const accounts = accountsResponse.success && Array.isArray(accountsResponse.data)
            ? accountsResponse.data
            : [];
        const knownFanPages = new Map(session.fanPages.map((item) => [item.pageId, item]));
        const mergedFanPages = fanPages.map((item) => ({
            ...item,
            additionalProfileId: knownFanPages.get(item.pageId)?.additionalProfileId ?? "",
        }));
        for (const item of session.fanPages) {
            if (!mergedFanPages.some((page) => page.pageId === item.pageId)) mergedFanPages.push(item);
        }
        const accountsWithPixels = [];
        for (const account of accounts) {
            const pixelsResult = await getAdPixels({
                page: session.page,
                accessToken: session.accessToken,
                adAccountId: account.id,
                timeout: 60000,
            });
            accountsWithPixels.push({
                ...account,
                pixels: pixelsResult.success ? pixelsResult.data : [],
                pixelsError: pixelsResult.success ? null : (pixelsResult.error ?? pixelsResult.status),
            });
        }
        session.fanPages = mergedFanPages;
        session.overview = {
            hasFacebookPayload: Boolean(session.facebookPayload),
            hasAdsManagerPayload: session.context === "ADS_MANAGER" && Boolean(session.payload),
            hasAccessToken: Boolean(session.accessToken),
            hasBusinessManagerPayload: Boolean(session.businessManagerPayload),
            fanPages: mergedFanPages,
            adAccounts: accountsWithPixels,
            fanPagesError: fanPagesResponse.success
                ? null
                : (fanPagesResponse.error ?? "Не вдалося отримати список фанпейджів"),
            adAccountsError: accountsResponse.success
                ? null
                : (accountsResponse.error ?? "Не вдалося отримати рекламні кабінети"),
            businessInfo: null,
            updatedAt: new Date().toISOString(),
        };
    }


    async #capture(session, url, context) {
        const graphqlUrl = context === "ADS_MANAGER"
            ? adsManagerGraphqlUrl
            : facebookGraphqlUrl;
        const captured = assertAction(await captureGraphqlPayload(session.page, {
            profileUrl: url,
            graphqlUrl,
            timeout: 60000,
        }), `Не вдалося отримати payload для ${context}`);
        if (context === "FACEBOOK_MAIN") {
            session.facebookPayload = captured.data;
        }
        session.payload = context === "ADS_MANAGER"
            ? supplementAdsManagerPayload(captured.data, session.facebookPayload)
            : captured.data;
        session.payloadUrl = session.page.url();
        session.actorId = String(session.payload.__user ?? "");
        session.context = context;
        return captured.data;
    }

    async #ensureFacebookContext(session, actorId, url, context) {
        const expectedActor = String(actorId ?? "").trim();
        if (this.#hasCurrentPayload(session, context)
            && (!expectedActor || session.actorId === expectedActor)) {
            return;
        }
        await this.#capture(session, url, context);
        if (!expectedActor || session.actorId === expectedActor) return;
        assertAction(await switchToAdditionalProfile({
            page: session.page,
            commonPayload: session.payload,
            additionalProfileId: expectedActor,
            timeout: 60000,
        }), "Не вдалося перемкнути Facebook actor");
        await this.#capture(session, url, context);
        if (session.actorId !== expectedActor) {
            throw sessionError("Facebook actor не відповідає потрібному контексту", "FACEBOOK_ACTOR_MISMATCH");
        }
    }


    async #ensureAdsManager(session, adAccountId = "") {
        const normalizedAdAccountId = String(adAccountId ?? "").replace(/^act_/, "").trim();
        const url = normalizedAdAccountId
            ? `${adsManagerUrl}?act=${normalizedAdAccountId}`
            : adsManagerUrl;
        if (!this.#hasCurrentPayload(session, "ADS_MANAGER")) {
            await this.#capture(session, url, "ADS_MANAGER");
        }
        if (session.actorId !== session.mainActorId) {
            assertAction(await switchToAdditionalProfile({
                page: session.page,
                commonPayload: session.payload,
                additionalProfileId: session.mainActorId,
                timeout: 60000,
            }), "Не вдалося перемкнути Facebook actor для Ads Manager");
            await this.#capture(session, url, "ADS_MANAGER");
        }
        await this.#readAccessToken(session);
    }


    async #ensureBillingPagePayload(session, adAccountId) {
        const normalizedAdAccountId = String(adAccountId ?? "")
            .replace(/^act_/, "")
            .trim();
        if (!/^\d+$/.test(normalizedAdAccountId)) {
            throw sessionError(
                "Потрібен коректний ID рекламного акаунта для платіжних налаштувань",
                "BILLING_ACCOUNT_ID_INVALID",
                { stage: "ENSURE_BILLING_PAGE_PAYLOAD" }
            );
        }

        const targetUrl = new URL(
            billingPaymentSettingsPath,
            "https://adsmanager.facebook.com"
        );
        targetUrl.searchParams.set("nav_entry_point", "ads_ecosystem_navigation_menu");
        targetUrl.searchParams.set("placement", "ads_manager");
        targetUrl.searchParams.set("asset_id", normalizedAdAccountId);
        targetUrl.searchParams.set("payment_account_id", normalizedAdAccountId);

        const currentUrl = new URL(session.page.url());
        const isCorrectPage = currentUrl.hostname === targetUrl.hostname
            && currentUrl.pathname.replace(/\/$/, "") === billingPaymentSettingsPath.replace(/\/$/, "")
            && currentUrl.searchParams.get("asset_id") === normalizedAdAccountId
            && currentUrl.searchParams.get("payment_account_id") === normalizedAdAccountId;
        let payloadUrl = null;
        try {
            payloadUrl = session.payloadUrl ? new URL(session.payloadUrl) : null;
        } catch {
            payloadUrl = null;
        }
        const hasBillingPayload = Boolean(
            payloadUrl
            && payloadUrl.hostname === targetUrl.hostname
            && payloadUrl.pathname.replace(/\/$/, "") === billingPaymentSettingsPath.replace(/\/$/, "")
            && payloadUrl.searchParams.get("asset_id") === normalizedAdAccountId
            && payloadUrl.searchParams.get("payment_account_id") === normalizedAdAccountId
        );

        await session.report.append("ads.billing_page.check", {
            currentHost: currentUrl.hostname,
            currentPath: currentUrl.pathname,
            targetPath: targetUrl.pathname,
            accountIdMatches: isCorrectPage,
            payloadMatches: hasBillingPayload,
            navigated: !isCorrectPage || !hasBillingPayload,
        });

        if (!isCorrectPage || !hasBillingPayload) {
            try {
                await this.#capture(
                    session,
                    targetUrl.toString(),
                    "ADS_MANAGER"
                );
            } catch (error) {
                await session.report.append("ads.billing_page.navigation_failed", {
                    message: String(error?.message ?? error),
                });
                throw sessionError(
                    "Не вдалося відкрити сторінку платіжних налаштувань Ads Manager",
                    "BILLING_PAGE_NAVIGATION_FAILED",
                    { stage: "CAPTURE_BILLING_PAGE_PAYLOAD" }
                );
            }
        }
        await session.report.append("ads.billing_page.payload_ready", {
            pageUrl: session.page.url(),
            payloadUrl: session.payloadUrl,
            accountId: normalizedAdAccountId,
        });
    }


    async #ensureBillingPaymentSettings(session, adAccountId) {
        await this.#ensureBillingPagePayload(session, adAccountId);

        const initiallyMissingModules = await session.page.evaluate((moduleNames) => {
            const isReady = (moduleName) => {
                try {
                    const moduleValue = require(moduleName);
                    if (moduleName === "BillingCreditCardUtils") {
                        return Boolean(
                            moduleValue
                            && typeof moduleValue.formatCardNumber === "function"
                            && typeof moduleValue.buildSaveCardCredentialInput === "function"
                        );
                    }
                    return moduleValue !== null && typeof moduleValue !== "undefined";
                } catch {
                    return false;
                }
            };
            return moduleNames.filter((moduleName) => !isReady(moduleName));
        }, billingPaymentRuntimeModules).catch(() => billingPaymentRuntimeModules);

        await session.report.append("ads.billing_modules.checked", {
            moduleNames: billingPaymentRuntimeModules,
            missingModules: initiallyMissingModules,
            pageUrl: session.page.url(),
        });

        if (initiallyMissingModules.length > 0) {
            const chunkResults = await session.page.evaluate(async ({ missingModules, chunks }) => {
                const inspectModule = (moduleName) => {
                    try {
                        const moduleValue = require(moduleName);
                        const requiredMethods = moduleName === "BillingCreditCardUtils"
                            ? ["formatCardNumber", "buildSaveCardCredentialInput"]
                            : [];
                        const missingMethods = requiredMethods.filter(
                            (methodName) => typeof moduleValue?.[methodName] !== "function"
                        );
                        return {
                            moduleName,
                            ready: moduleValue !== null
                                && typeof moduleValue !== "undefined"
                                && missingMethods.length === 0,
                            valueType: moduleValue === null ? "null" : typeof moduleValue,
                            missingMethods,
                        };
                    } catch (error) {
                        return {
                            moduleName,
                            ready: false,
                            valueType: "unavailable",
                            missingMethods: [],
                            error: String(error?.message ?? error),
                        };
                    }
                };
                const isChunkReady = (chunk) => chunk.moduleNames.every(
                    (moduleName) => inspectModule(moduleName).ready
                );
                const cardUtilsNeedsLoad = missingModules.includes("BillingCreditCardUtils");
                const cardBootstrapChunkNames = [
                    "BillingProtectedString",
                    "FrontierPM card assets",
                    "BillingCreditCardUtils",
                ];
                const shouldLoadChunk = (chunk) => (
                    chunk.moduleNames.some((moduleName) => missingModules.includes(moduleName))
                    || (cardUtilsNeedsLoad && cardBootstrapChunkNames.includes(chunk.name))
                );
                const loadChunk = (chunk) => new Promise((resolve) => {
                    const isCardBootstrapChunk = cardBootstrapChunkNames.includes(chunk.name);
                    if (!isCardBootstrapChunk && isChunkReady(chunk)) {
                        resolve({
                            chunkName: chunk.name,
                            url: chunk.url,
                            status: "already_ready",
                            moduleStates: chunk.moduleNames.map(inspectModule),
                        });
                        return;
                    }

                    const script = document.createElement("script");
                    const finish = (status) => {
                        window.clearTimeout(timeoutId);
                        if (status !== "loaded") script.remove();
                        resolve({
                            chunkName: chunk.name,
                            url: chunk.url,
                            status,
                            moduleStates: isCardBootstrapChunk
                                ? []
                                : chunk.moduleNames.map(inspectModule),
                        });
                    };
                    const timeoutId = window.setTimeout(() => finish("timeout"), 30000);
                    script.src = chunk.url;
                    script.async = false;
                    script.onload = () => finish("loaded");
                    script.onerror = () => finish("load_error");
                    document.head.appendChild(script);
                });

                const results = [];
                for (const chunk of chunks) {
                    if (shouldLoadChunk(chunk)) results.push(await loadChunk(chunk));
                }
                return results;
            }, {
                missingModules: initiallyMissingModules,
                chunks: billingRuntimeModuleChunks,
            }).catch((error) => [{
                status: "injection_error",
                error: String(error?.message ?? error),
            }]);

            await session.report.append("ads.billing_modules.chunks_loaded", {
                initiallyMissingModules,
                chunkResults,
            });
        }

        const ixBootstrap = await session.page.evaluate((assets) => {
            const inspectModule = (moduleName) => {
                try {
                    const moduleValue = require(moduleName);
                    const requiredMethods = moduleName === "BillingCreditCardUtils"
                        ? ["formatCardNumber", "buildSaveCardCredentialInput"]
                        : [];
                    const missingMethods = requiredMethods.filter(
                        (methodName) => typeof moduleValue?.[methodName] !== "function"
                    );
                    return {
                        moduleName,
                        ready: moduleValue !== null
                            && typeof moduleValue !== "undefined"
                            && missingMethods.length === 0,
                        valueType: moduleValue === null ? "null" : typeof moduleValue,
                        missingMethods,
                    };
                } catch (error) {
                    return {
                        moduleName,
                        ready: false,
                        valueType: "unavailable",
                        missingMethods: [],
                        error: String(error?.message ?? error),
                    };
                }
            };

            try {
                const ix = require("ix");
                if (!ix || typeof ix.add !== "function") {
                    throw new Error("IX_ASSET_REGISTRY_UNAVAILABLE");
                }
                ix.add(assets, {});
                return {
                    registered: true,
                    assetIds: Object.keys(assets),
                    moduleStates: [
                        "BillingCreditCardTypes",
                        "BillingCreditCardNumber",
                        "BillingCreditCardUtils",
                    ].map(inspectModule),
                };
            } catch (error) {
                return {
                    registered: false,
                    assetIds: Object.keys(assets),
                    error: String(error?.message ?? error),
                };
            }
        }, billingIxAssets).catch((error) => ({
            registered: false,
            assetIds: Object.keys(billingIxAssets),
            error: String(error?.message ?? error),
        }));

        await session.report.append("ads.billing_ix_assets_registered", ixBootstrap);
        await session.report.append("ads.billing_card_types_ready", {
            moduleState: ixBootstrap.moduleStates?.find(
                ({ moduleName }) => moduleName === "BillingCreditCardTypes"
            ) ?? null,
        });
        await session.report.append("ads.billing_card_number_ready", {
            moduleState: ixBootstrap.moduleStates?.find(
                ({ moduleName }) => moduleName === "BillingCreditCardNumber"
            ) ?? null,
        });

        const requiredRuntimeModules = [
            ...billingPaymentRuntimeModules,
            ...billingCardRuntimeModules,
        ];

        await session.report.append("ads.billing_modules.waiting", {
            moduleNames: requiredRuntimeModules,
            timeoutMs: 45000,
        });

        try {
            await session.page.waitForFunction(
                (moduleNames) => moduleNames.every((moduleName) => {
                    try {
                        const moduleValue = require(moduleName);
                        if (moduleName === "BillingCreditCardUtils") {
                            return Boolean(
                                moduleValue
                                && typeof moduleValue.formatCardNumber === "function"
                                && typeof moduleValue.buildSaveCardCredentialInput === "function"
                            );
                        }
                        return moduleValue !== null && typeof moduleValue !== "undefined";
                    } catch {
                        return false;
                    }
                }),
                { timeout: 45000 },
                requiredRuntimeModules
            );
        } catch {
            const unresolvedModules = await session.page.evaluate((moduleNames) => (
                moduleNames.map((moduleName) => {
                    try {
                        const moduleValue = require(moduleName);
                        const missingMethods = moduleName === "BillingCreditCardUtils"
                            ? ["formatCardNumber", "buildSaveCardCredentialInput"].filter(
                                (methodName) => typeof moduleValue?.[methodName] !== "function"
                            )
                            : [];
                        return {
                            moduleName,
                            ready: moduleValue !== null
                                && typeof moduleValue !== "undefined"
                                && missingMethods.length === 0,
                            valueType: moduleValue === null ? "null" : typeof moduleValue,
                            missingMethods,
                        };
                    } catch (error) {
                        return {
                            moduleName,
                            ready: false,
                            valueType: "unavailable",
                            missingMethods: [],
                            error: String(error?.message ?? error),
                        };
                    }
                }).filter((moduleState) => !moduleState.ready)
            ), requiredRuntimeModules).catch(() => (
                requiredRuntimeModules.map((moduleName) => ({ moduleName, ready: false }))
            ));
            const missingModules = unresolvedModules.map(({ moduleName }) => moduleName);

            await session.report.append("ads.billing_modules.wait_failed", {
                missingModules,
                unresolvedModules,
                pageUrl: session.page.url(),
            });
            throw sessionError(
                `Billing-модулі не завантажилися: ${missingModules.join(", ")}`,
                "BILLING_MODULES_NOT_READY",
                {
                    stage: "WAIT_BILLING_MODULES",
                    result: { missingModules },
                }
            );
        }

        await session.report.append("ads.billing_modules.ready", {
            moduleNames: requiredRuntimeModules,
            pagePath: new URL(session.page.url()).pathname,
        });
    }


    async #ensureAccessToken(session) {
        if (session.accessToken) return;
        await this.#ensureAdsManager(session);
    }


    #hasCurrentPayload(session, context) {
        if (!session.payload || session.context !== context || !session.payloadUrl) return false;
        if (context === "ADS_MANAGER") {
            return isAdsManagerUrl(session.payloadUrl)
                && isAdsManagerUrl(session.page.url());
        }
        return session.payloadUrl === session.page.url();
    }


    async #readAccessToken(session) {
        if (session.accessToken) return;
        await session.page.waitForFunction(
            () => document.documentElement?.innerHTML.includes("EAA"),
            { timeout: 15000 }
        ).catch(() => {});
        const html = await session.page.content();
        const token = extractFacebookAccessTokenFromHtml(html);
        if (!token) {
            throw sessionError("Не знайдено access token у Ads Manager", "ADS_MANAGER_TOKEN_NOT_FOUND");
        }
        session.accessToken = token;
    }


    async #finish(sessionId, closeProfile) {
        const session = this.#getSession(sessionId);
        await session.operation.catch(() => {});
        this.#sessions.delete(session.id);
        const cleanupErrors = [];
        try { session.browser?.disconnect(); } catch (error) { cleanupErrors.push(error.message); }
        session.browser = null;
        session.page = null;
        if (closeProfile) {
            try { await this.adsPower.closeProfile(session.profileNo); } catch (error) {
                cleanupErrors.push(error.message);
            }
        }
        await session.report.append(closeProfile ? "session.profile_closed" : "session.disconnected", {
            cleanupErrors,
        }).catch(() => {});
        return { disconnected: true, profileClosed: closeProfile, cleanupErrors };
    }


    async #detach(sessionId) {
        const session = this.#getSession(sessionId);
        await session.operation.catch(() => {});
        const cleanupErrors = [];
        try { session.browser?.disconnect(); } catch (error) { cleanupErrors.push(error.message); }
        session.browser = null;
        session.page = null;
        await session.report.append("session.disconnected", { cleanupErrors }).catch(() => {});
        return { disconnected: true, profileClosed: false, cleanupErrors };
    }
}
