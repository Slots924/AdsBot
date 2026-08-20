import puppeteer from "puppeteer-core";

import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import scrollToPostLikeButton from "../../facebook/actions/scrollToPostLikeButton.js";
import setRandomPostReaction from "../../facebook/actions/setRandomPostReaction.js";
import isPostAvailable from "../../facebook/post/checks/isPostAvailable.js";
import commentOnPost from "../../facebook/workflows/commentOnPost.js";
import replyToComment from "../../facebook/workflows/replyToComment.js";
import ensureAdsPowerProfileReady from "../profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../profile/ensureFacebookAccountLoggedIn.js";


export default async function executeCommentWithProfile({
    adsPower,
    profile,
    postUrl,
    comment,
    parentComment = null,
    browserMode = "visible",
    disableImages = false,
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
        error: null,
        cleanupErrors: [],
    };
    let browser;
    let profileOpened = false;
    let abortCleanupPromise = null;
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
    };
    const handleAbort = () => {
        abortCleanupPromise ??= stopOpenedProfile();
    };

    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
        assertNotAborted();
        const adsPowerReady =
            await ensureAdsPowerProfileReady(
                adsPower,
                profile
            );

        if (!adsPowerReady) {
            throw new Error(
                "AdsPower-профіль не готовий до роботи"
            );
        }

        assertNotAborted();
        result.stage = "OPEN_PROFILE";
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
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
        result.stage = "OPEN_FACEBOOK";
        await openPageWithoutPopups(
            page,
            "https://www.facebook.com/"
        );

        assertNotAborted();
        result.stage = "FACEBOOK_LOGIN";
        const loggedIn = await ensureFacebookAccountLoggedIn(
            adsPower,
            profile,
            page
        );

        if (!loggedIn) {
            throw new Error(
                "Не вдалося підтвердити вхід у Facebook"
            );
        }

        assertNotAborted();
        result.stage = "FACEBOOK_ACTIVE";
        const active = await ensureFacebookAccountActive(
            adsPower,
            profile,
            page
        );

        if (!active) {
            throw new Error("Facebook-акаунт не активний");
        }

        assertNotAborted();
        result.stage = "ENSURE_ENGLISH";
        await ensureEnglish(page);

        assertNotAborted();
        result.stage = "OPEN_POST";
        await openPageWithoutPopups(page, postUrl);

        result.stage = "POST_AVAILABLE";
        const postAvailable = await isPostAvailable(page);

        if (!postAvailable) {
            throw new Error("Facebook-пост недоступний");
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
