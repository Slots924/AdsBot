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
const adsManagerUrl = "https://www.facebook.com/adsmanager/manage/campaigns";


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
                    error,
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
        const captured = assertAction(await captureGraphqlPayload(session.page, {
            profileUrl: url,
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


    async #ensureAccessToken(session) {
        if (session.accessToken) return;
        await this.#ensureAdsManager(session);
    }


    #hasCurrentPayload(session, context) {
        if (!session.payload || session.context !== context || !session.payloadUrl) return false;
        if (session.payloadUrl !== session.page.url()) return false;
        return context !== "ADS_MANAGER" || isAdsManagerUrl(session.page.url());
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
