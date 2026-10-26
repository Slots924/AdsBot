import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import openFacebookPostViaAuthorPage
    from "../../facebook/actions/openFacebookPostViaAuthorPage.js";
import scrollToPostLikeButton from "../../facebook/actions/scrollToPostLikeButton.js";
import setRandomPostReaction from "../../facebook/actions/setRandomPostReaction.js";
import commentOnPost from "../../facebook/workflows/commentOnPost.js";
import replyToComment from "../../facebook/workflows/replyToComment.js";
import ensureWorkerProxyReady from "../../services/proxy/ensureWorkerProxyReady.js";
import toAdsPowerProxyConfig from "../../services/proxy/toAdsPowerProxyConfig.js";
import checkProfileBeforeLaunch from "../profile/checkProfileBeforeLaunch.js";
import checkFacebookAfterLaunch from "../profile/checkFacebookAfterLaunch.js";


export default async function executeCommentWithProfile({
    adsPower,
    profile,
    postUrl,
    postId = null,
    comment,
    parentComment = null,
    browserMode = "visible",
    disableImages = false,
    workerId = null,
    workerProxy = null,
    onProxyUnavailable = null,
    logger = console,
    signal,
}) {
    const profileNo = String(profile?.profile_no ?? "невідомий");
    const actionType = comment.parent_id === null
        ? "comment"
        : "reply";
    const result = {
        success: false,
        actionType,
        profileNo,
        commentId: String(comment.id),
        stage: "ADSPOWER_READY",
        postOpen: null,
        stopTask: false,
        error: null,
        cleanupErrors: [],
    };
    let browser;
    let profileOpened = false;
    let abortCleanupPromise = null;
    let originalProxyConfig = null;
    let proxyApplied = false;
    const createAbortError = () => Object.assign(
        new Error("Виконання коментаря перервано"),
        { name: "AbortError", code: "COMMENTING_ABORTED" }
    );
    const assertNotAborted = () => {
        if (signal?.aborted) throw createAbortError();
    };
    const stopOpenedProfile = async () => {
        if (browser) {
            try {
                browser.disconnect();
            } catch (error) {
                result.cleanupErrors.push(
                    `Puppeteer disconnect: ${error.message}`
                );
            }
            browser = null;
        }
        if (profileOpened) {
            profileOpened = false;
            try {
                await adsPower.closeProfile(profileNo);
            } catch (error) {
                result.cleanupErrors.push(
                    `AdsPower closeProfile: ${error.message}`
                );
            }
        }
        if (proxyApplied && originalProxyConfig && profile?.profile_id) {
            proxyApplied = false;
            try {
                await adsPower.updateProfileProxy(
                    profile.profile_id,
                    originalProxyConfig
                );
            } catch (error) {
                result.cleanupErrors.push(
                    `AdsPower restore proxy: ${error.message}`
                );
            }
        }
    };
    const handleAbort = () => {
        abortCleanupPromise ??= stopOpenedProfile();
    };

    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
        assertNotAborted();
        let activeProfile = profile;
        let currentProxy = workerProxy;

        if (currentProxy) {
            if (!profile?.profile_id) {
                throw new Error("У профілю відсутній profile_id");
            }

            while (true) {
                assertNotAborted();
                result.stage = "REFRESH_PROXY";
                const ready = await ensureWorkerProxyReady(currentProxy, {
                    timeoutMs: 60000,
                    signal,
                });
                if (ready.working) break;

                if (typeof onProxyUnavailable !== "function") {
                    result.skippedDueToProxy = true;
                    result.error = "Проксі воркера недоступна";
                    return result;
                }

                const action = await onProxyUnavailable({
                    workerId,
                    commentId: String(comment.id),
                    proxy: currentProxy,
                });
                if (action?.type === "replace" && action.proxy) {
                    currentProxy = action.proxy;
                    continue;
                }

                result.skippedDueToProxy = true;
                result.error = "Коментар пропущено через проксі воркера";
                return result;
            }

            assertNotAborted();
            result.stage = "APPLY_PROXY";
            originalProxyConfig = profile.user_proxy_config
                ? structuredClone(profile.user_proxy_config)
                : { proxy_soft: "no_proxy", proxy_type: "no_proxy" };
            const appliedConfig = toAdsPowerProxyConfig(currentProxy);
            proxyApplied = true;
            await adsPower.updateProfileProxy(
                profile.profile_id,
                appliedConfig
            );
            activeProfile = {
                ...profile,
                user_proxy_config: appliedConfig,
            };
        }

        const readiness = await checkProfileBeforeLaunch({
            adsPower, profile: activeProfile,
            checks: { adsPowerReady: true, blockedTags: ["BAN", "LOGIN_ERROR"] },
        });

        if (!readiness.ok) {
            throw new Error(
                "AdsPower-профіль не готовий до роботи"
            );
        }

        assertNotAborted();
        result.stage = "OPEN_PROFILE";
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
            restoreLastOpenedTabs: false,
            proxyDetection: true,
        });
        profileOpened = true;

        assertNotAborted();
        result.stage = "CONNECT_BROWSER";
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });

        const pages = await browser.pages();
        const page = pages[0] ?? await browser.newPage();

        assertNotAborted();
        result.stage = "CONFIGURE_BROWSER_WINDOW";
        result.browserWindow = await configureFacebookAutomationWindow(page, {
            browserMode,
        });

        assertNotAborted();
        result.stage = "OPEN_FACEBOOK";
        await openPageWithoutPopups(
            page,
            "https://www.facebook.com/"
        );

        const facebook = await checkFacebookAfterLaunch({
            adsPower, profile, page, signal,
            checks: { loggedIn: true, active: true, ensureEnglish: true },
            englishFailure: "continue",
            onCheck: (check) => {
                assertNotAborted();
                result.stage = { loggedIn: "FACEBOOK_LOGIN", active: "FACEBOOK_ACTIVE", ensureEnglish: "ENSURE_ENGLISH" }[check];
            },
        });
        if (!facebook.ok) {
            throw new Error(facebook.failedCheck === "loggedIn"
                ? "Не вдалося підтвердити вхід у Facebook"
                : "Facebook-акаунт не активний");
        }

        assertNotAborted();
        result.stage = "OPEN_POST_VIA_AUTHOR_PAGE";
        result.postOpen = await openFacebookPostViaAuthorPage(page, {
            postUrl,
            expectedPostId: postId,
            logger,
        });

        if (!result.postOpen.success) {
            throw new Error(
                `Не вдалося відкрити потрібний Facebook-допис: ${result.postOpen.status}`
            );
        }

        assertNotAborted();
        try {
            await scrollToPostLikeButton(page);
        } catch (error) {
            logger.error(
                `Не вдалося прокрутити до кнопки Like, продовжуємо роботу: ${error.message}`
            );
        }

        await setRandomPostReaction(page);

        assertNotAborted();
        if (actionType === "comment") {
            result.stage = "WRITE_COMMENT";
            result.success = await commentOnPost(
                page,
                comment.text
            );
        } else {
            result.stage = "WRITE_REPLY";
            result.success = await replyToComment(
                page,
                parentComment.text,
                comment.text
            );
        }

        if (!result.success) {
            throw new Error(
                actionType === "comment"
                    ? "Не вдалося опублікувати коментар"
                    : "Не вдалося опублікувати reply"
            );
        }
    } catch (error) {
        result.success = false;
        result.error = signal?.aborted
            ? "Виконання коментаря перервано"
            : error.message;
        result.aborted = signal?.aborted || error?.name === "AbortError";
    } finally {
        signal?.removeEventListener("abort", handleAbort);
        if (abortCleanupPromise) await abortCleanupPromise;
        await stopOpenedProfile();
    }

    return result;
}
