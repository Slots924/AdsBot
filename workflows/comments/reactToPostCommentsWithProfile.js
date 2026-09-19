import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import inspectPostComments from "../../facebook/actions/inspectPostComments.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import setCommentReaction, {
    commentReactionStatuses,
} from "../../facebook/actions/setCommentReaction.js";
import loadAllPostComments from "../../facebook/workflows/loadAllPostComments.js";
import ensureWorkerProxyReady from "../../services/proxy/ensureWorkerProxyReady.js";
import toAdsPowerProxyConfig from "../../services/proxy/toAdsPowerProxyConfig.js";
import ensureAdsPowerProfileReady from "../profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../profile/ensureFacebookAccountLoggedIn.js";


export default async function reactToPostCommentsWithProfile({
    adsPower,
    profile,
    postUrl,
    reaction,
    includeReplies = false,
    browserMode = "visible",
    disableImages = false,
    workerId = null,
    workerProxy = null,
    onProxyUnavailable = null,
    signal,
} = {}) {
    const profileNo = String(profile?.profile_no ?? "невідомий");
    const result = {
        profileNo,
        reaction,
        outcome: "failed",
        stage: "VALIDATE",
        applied: 0,
        alreadyReacted: 0,
        failed: 0,
        commentsFound: 0,
        errors: [],
        error: null,
        cleanupErrors: [],
    };
    let browser;
    let profileOpened = false;
    let proxyApplied = false;
    let originalProxyConfig = null;

    const assertNotAborted = () => {
        if (signal?.aborted) {
            throw Object.assign(new Error("Задачу реакцій перервано"), {
                name: "AbortError",
            });
        }
    };
    const cleanup = async () => {
        try { browser?.disconnect(); } catch (error) {
            result.cleanupErrors.push(`Puppeteer disconnect: ${error.message}`);
        }
        if (profileOpened) {
            profileOpened = false;
            try { await adsPower.closeProfile(profileNo); } catch (error) {
                result.cleanupErrors.push(`AdsPower closeProfile: ${error.message}`);
            }
        }
        if (proxyApplied && originalProxyConfig && profile?.profile_id) {
            try {
                await adsPower.updateProfileProxy(profile.profile_id, originalProxyConfig);
            } catch (error) {
                result.cleanupErrors.push(`AdsPower restore proxy: ${error.message}`);
            }
        }
    };

    try {
        assertNotAborted();
        let activeProfile = profile;
        if (workerProxy) {
            result.stage = "CHECK_PROXY";
            let currentProxy = workerProxy;
            while (true) {
                const ready = await ensureWorkerProxyReady(currentProxy, { signal });
                if (ready.working) break;
                if (typeof onProxyUnavailable !== "function") {
                    result.outcome = "skipped";
                    result.error = "Проксі воркера недоступна";
                    return result;
                }
                const decision = await onProxyUnavailable({ workerId, profileNo, proxy: currentProxy });
                if (decision?.type !== "replace" || !decision.proxy) {
                    result.outcome = "skipped";
                    result.error = "Профіль пропущено через недоступну проксі";
                    return result;
                }
                currentProxy = decision.proxy;
            }
            if (!profile?.profile_id) throw new Error("У профілю відсутній profile_id");
            originalProxyConfig = profile.user_proxy_config
                ? structuredClone(profile.user_proxy_config)
                : { proxy_soft: "no_proxy", proxy_type: "no_proxy" };
            const proxyConfig = toAdsPowerProxyConfig(currentProxy);
            proxyApplied = true;
            await adsPower.updateProfileProxy(profile.profile_id, proxyConfig);
            activeProfile = { ...profile, user_proxy_config: proxyConfig };
        }

        result.stage = "ADSPOWER_READY";
        if (!await ensureAdsPowerProfileReady(adsPower, activeProfile)) {
            throw new Error("AdsPower-профіль не готовий до роботи");
        }
        assertNotAborted();
        result.stage = "OPEN_PROFILE";
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode });

        result.stage = "OPEN_POST";
        await openPageWithoutPopups(page, postUrl);
        if (!await ensureFacebookAccountLoggedIn(adsPower, activeProfile, page)) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }
        if (!await ensureFacebookAccountActive(adsPower, activeProfile, page)) {
            throw new Error("Facebook-акаунт неактивний");
        }
        await ensureEnglish(page);

        result.stage = "LOAD_COMMENTS";
        if (!await loadAllPostComments(page, { expandReplies: includeReplies })) {
            throw new Error("Не вдалося завантажити коментарі поста");
        }
        const comments = await inspectPostComments(page);
        const ids = [...new Set(comments
            .filter((comment) => includeReplies || !comment.isReply)
            .map((comment) => String(comment.id ?? "").trim())
            .filter(Boolean))].reverse();
        result.commentsFound = ids.length;

        for (const commentId of ids) {
            assertNotAborted();
            result.stage = "SET_REACTION";
            const item = await setCommentReaction(page, { commentId, reaction });
            if (item.status === commentReactionStatuses.APPLIED) result.applied += 1;
            else if (item.status === commentReactionStatuses.ALREADY_REACTED) result.alreadyReacted += 1;
            else {
                result.failed += 1;
                result.errors.push({ commentId, reason: item.reason ?? "UNKNOWN" });
            }
        }

        if (result.applied === 0) {
            result.outcome = "failed";
            result.error = result.commentsFound === 0
                ? "Не знайдено коментарів з доступним ID"
                : "Жодної реакції не поставлено";
        } else if (result.failed > 0 || result.alreadyReacted > 0) {
            result.outcome = "completed_with_warnings";
        } else {
            result.outcome = "success";
        }
    } catch (error) {
        result.outcome = "failed";
        result.error = signal?.aborted ? "Задачу реакцій перервано" : error.message;
        result.aborted = signal?.aborted || error?.name === "AbortError";
    } finally {
        await cleanup();
    }
    return result;
}
