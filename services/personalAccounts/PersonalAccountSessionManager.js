import { randomUUID } from "node:crypto";

import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import captureGraphqlPayload from "../../facebook/api-actions/captureGraphqlPayload.js";
import createFanPage from "../../facebook/api-actions/pages/createFanPage.js";
import switchToAdditionalProfile from "../../facebook/api-actions/pages/switchToAdditionalProfile.js";
import grantAdditionalProfileAccess
    from "../../facebook/workflows/grantAdditionalProfileAccess.js";
import checkBillingAccountInformation
    from "../../facebook/api-actions/ads-manager/checkBillingAccountInformation.js";
import updateBusinessInfo from "../../facebook/api-actions/ads-manager/updateBusinessInfo.js";
import addCreditCardPaymentMethod
    from "../../facebook/api-actions/ads-manager/addCreditCardPaymentMethod.js";
import getBrowserAdAccounts from "../../facebook/api-actions/ads-manager/getAdAccounts.js";
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
const billingPaymentSettingsPath = "/adsmanager/billing_hub/payment_settings/";
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


function sessionError(message, code, details = {}) {
    return Object.assign(new Error(message), { code, ...details });
}


function assertAction(result, fallback) {
    if (result?.success) return result;
    throw sessionError(
        result?.error || fallback,
        result?.status || "PERSONAL_ACCOUNT_ACTION_FAILED",
        {
            stage: result?.stage ?? null,
            httpStatus: result?.httpStatus ?? null,
            graphCode: result?.graphCode ?? null,
            graphSubcode: result?.graphSubcode ?? null,
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
        hasPhoneFlow: Boolean(session.phoneFlow),
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
    } = {}) {
        this.adsPower = adsPower;
        this.creditCardStore = creditCardStore;
        this.facebookAccountManager = facebookAccountManager;
        this.reloadFacebookBackend = reloadFacebookBackend;
        this.reportsDirectory = reportsDirectory;
        this.logger = logger;
    }


    async start({ profileNo }) {
        const normalizedProfileNo = String(profileNo ?? "").trim();
        if (!/^\d+$/.test(normalizedProfileNo)) {
            throw sessionError("Потрібен номер AdsPower-профілю", "PROFILE_NO_REQUIRED");
        }
        for (const active of this.#sessions.values()) {
            if (active.profileNo !== normalizedProfileNo) continue;
            if (active.browser?.connected) return publicSession(active);
            return this.#reconnect(active);
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
            const browserData = await this.adsPower.openProfile(normalizedProfileNo, {
                browserMode: "visible",
                restoreLastOpenedTabs: false,
            });
            opened = true;
            browser = await puppeteer.connect({
                browserWSEndpoint: browserData.ws.puppeteer,
                defaultViewport: null,
            });
            const page = (await browser.pages())[0] ?? await browser.newPage();
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
                payloadUrl: page.url(),
                actorId: String(captured.data.__user ?? ""),
                mainActorId: String(captured.data.__user ?? ""),
                pageId: null,
                additionalProfileId: null,
                accessToken: "",
                phoneFlow: null,
                operation: Promise.resolve(),
                report,
                createdAt: new Date().toISOString(),
            };
            this.#sessions.set(id, session);
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
            return {
                status: result.status,
                pageId: session.pageId,
                additionalProfileId: session.additionalProfileId,
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
            const switchResult = assertAction(await switchToAdditionalProfile({
                page: session.page,
                commonPayload: session.payload,
                additionalProfileId,
                timeout: 60000,
            }), "Не вдалося перемкнутися на фанпейдж");
            session.additionalProfileId = additionalProfileId;
            // Facebook інколи не повертає body для успішного profile switch.
            // Наступна дія самостійно захопить новий payload і перевірить actor.
            session.payload = null;
            session.context = "FACEBOOK_SWITCH_REQUESTED";
            return {
                status: switchResult.status,
                additionalProfileId,
                session: publicSession(session),
            };
        });
    }


    grantFanPageAccess(sessionId, input = {}) {
        return this.#perform(sessionId, "fanpage.access_grant", async (session) => {
            const additionalProfileId = String(
                input.additionalProfileId ?? session.additionalProfileId ?? ""
            ).trim();
            await this.#ensureFacebookContext(
                session,
                additionalProfileId,
                "https://www.facebook.com/settings/?tab=profile_access",
                "FACEBOOK_PAGE_ACCESS"
            );
            const result = assertAction(await grantAdditionalProfileAccess({
                page: session.page,
                additionalProfileId,
                targetUserId: input.targetUserId,
                password: session.profile.password,
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
            const result = assertAction(await requestPhoneVerificationCode({
                page: session.page,
                commonPayload: session.payload,
                adAccountId: input.adAccountId,
                phoneE164: input.phoneE164,
                countryCode: input.countryCode,
                locale: input.locale ?? "en_US",
                timeout: 60000,
            }), "Не вдалося надіслати SMS-код");
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
                throw sessionError("Спочатку надішліть SMS-код", "PHONE_FLOW_REQUIRED");
            }
            await this.#ensureAdsManager(session, session.phoneFlow.adAccountId);
            const result = assertAction(await submitPhoneVerificationCode({
                page: session.page,
                commonPayload: session.payload,
                flow: session.phoneFlow,
                code: input.code,
                timeout: 60000,
            }), "Не вдалося підтвердити SMS-код");
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
        try {
            browser = await puppeteer.connect({
                browserWSEndpoint: session.wsEndpoint,
                defaultViewport: null,
            });
            const pages = await browser.pages();
            const page = pages.find((item) => item.url().includes("facebook.com"))
                ?? pages[0]
                ?? await browser.newPage();
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
                    result,
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


    async #capture(session, url, context) {
        const graphqlUrl = context === "ADS_MANAGER"
            ? adsManagerGraphqlUrl
            : facebookGraphqlUrl;
        const captured = assertAction(await captureGraphqlPayload(session.page, {
            profileUrl: url,
            graphqlUrl,
            timeout: 60000,
        }), `Не вдалося отримати payload для ${context}`);
        session.payload = captured.data;
        session.payloadUrl = session.page.url();
        session.actorId = String(captured.data.__user ?? "");
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


    async #ensureBillingPaymentSettings(session, adAccountId) {
        const normalizedAdAccountId = String(adAccountId ?? "")
            .replace(/^act_/, "")
            .trim();
        if (!/^\d+$/.test(normalizedAdAccountId)) {
            throw sessionError(
                "Потрібен коректний ID рекламного акаунта для платіжних налаштувань",
                "BILLING_ACCOUNT_ID_INVALID",
                { stage: "ENSURE_BILLING_PAYMENT_SETTINGS" }
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

        await session.report.append("ads.billing_page.check", {
            currentHost: currentUrl.hostname,
            currentPath: currentUrl.pathname,
            targetPath: targetUrl.pathname,
            accountIdMatches: isCorrectPage,
            navigated: !isCorrectPage,
        });

        if (!isCorrectPage) {
            try {
                await session.page.goto(targetUrl.toString(), {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });
            } catch (error) {
                await session.report.append("ads.billing_page.navigation_failed", {
                    message: String(error?.message ?? error),
                });
                throw sessionError(
                    "Не вдалося відкрити сторінку платіжних налаштувань Ads Manager",
                    "BILLING_PAGE_NAVIGATION_FAILED",
                    { stage: "NAVIGATE_BILLING_PAYMENT_SETTINGS" }
                );
            }
        }

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
