import path from "node:path";

import puppeteer from "puppeteer-core";

import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import changeFacebookCoverPhoto, {
    facebookCoverPhotoChangeStatuses,
} from "../../facebook/actions/changeFacebookCoverPhoto.js";
import changeFacebookName, {
    facebookNameChangeStatuses,
} from "../../facebook/actions/changeFacebookName.js";
import changeFacebookProfilePicture, {
    facebookAvatarChangeStatuses,
} from "../../facebook/actions/changeFacebookProfilePicture.js";
import deleteAllFacebookPersonalProfilePosts, {
    facebookPersonalProfilePostDeletionStatuses,
} from "../../facebook/actions/deleteAllFacebookPersonalProfilePosts.js";
import ensureEnglish from "../../facebook/actions/ensureEnglish.js";
import fillFacebookPersonalProfileAbout from "../../facebook/actions/fillFacebookPersonalProfileAbout.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import publishFacebookPersonalProfileMediaPostsWithDates from "../../facebook/actions/publishFacebookPersonalProfileMediaPostsWithDates.js";
import buildAdsPowerProfileName from "../../services/accounts/buildAdsPowerProfileName.js";
import getCommentAccountSetupSkipReason, {
    commentAccountSetupSkipReasons,
    describeCommentAccountSetupSkipReason,
} from "../../services/accounts/getCommentAccountSetupSkipReason.js";
import {
    classifyPhotoFiles,
    getProfilePhotoRejectReason,
    renamePhotoSet,
} from "../../services/accounts/photoSets.js";
import createRandomPostDates from "../../services/accounts/randomPostDates.js";
import markProfileGender from "../../services/profile/tags/markProfileGender.js";
import markProfileAsChangeNameError from "../../services/profile/tags/markProfileAsChangeNameError.js";
import ensureWorkerProxyReady from "../../services/proxy/ensureWorkerProxyReady.js";
import toAdsPowerProxyConfig from "../../services/proxy/toAdsPowerProxyConfig.js";
import { waitHuman } from "../../facebook/browser/timing.js";
import ensureAdsPowerProfileReady from "../profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../profile/ensureFacebookAccountLoggedIn.js";


const FACEBOOK_ME_URL = "https://www.facebook.com/me";
const unsuitablePhotoStatuses = new Set([
    facebookAvatarChangeStatuses.INVALID_IMAGE,
    facebookCoverPhotoChangeStatuses.INVALID_IMAGE,
]);
const acceptedDeleteStatuses = new Set([
    facebookPersonalProfilePostDeletionStatuses.CLEANED,
    facebookPersonalProfilePostDeletionStatuses.NO_POSTS,
]);
const restartableNameChangeErrorCodes = new Set([
    "FACEBOOK_NAME_DIALOG_NOT_OPENED",
    "FACEBOOK_NAME_DOM_NOT_STABLE",
]);
const MAX_NAME_PROFILE_RESTARTS = 1;


function createStep(fields = {}) {
    return {
        ok: false,
        skipped: false,
        reason: null,
        detail: null,
        status: null,
        error: null,
        path: null,
        ...fields,
    };
}


function fileLabel(filePath) {
    return filePath ? path.basename(filePath) : null;
}


function createEmptySteps() {
    return {
        name: createStep(),
        avatar: createStep(),
        cover: createStep(),
        deletePosts: createStep(),
        posts: createStep(),
        about: createStep(),
        genderTag: createStep(),
        adsPowerRename: createStep(),
        photoFolderRename: createStep(),
    };
}


async function tryProfilePhoto({
    changeFn,
    page,
    candidate,
    fallbackPool,
    usedPaths,
    logger,
    role = "avatar",
}) {
    const pathsToTry = [];
    if (candidate) pathsToTry.push(candidate);
    for (const filePath of fallbackPool) {
        if (!usedPaths.has(filePath) && filePath !== candidate) {
            pathsToTry.push(filePath);
        }
    }

    if (pathsToTry.length === 0) {
        return {
            step: createStep({
                skipped: true,
                reason: "Немає фото",
            }),
            unusedCandidate: candidate ?? null,
        };
    }

    let lastResult = null;
    const skippedUnsuitable = [];
    for (const imagePath of pathsToTry) {
        const rejectReason = await getProfilePhotoRejectReason(
            imagePath,
            role
        );
        if (rejectReason) {
            skippedUnsuitable.push(
                `${fileLabel(imagePath) || imagePath}: ${rejectReason}`
            );
            continue;
        }

        const result = await changeFn(page, { imagePath, logger });
        lastResult = result;
        if (result?.success) {
            usedPaths.add(imagePath);
            return {
                step: createStep({
                    ok: true,
                    path: imagePath,
                    status: result.status,
                    detail: fileLabel(imagePath)
                        + (imagePath !== candidate ? " (запасне фото)" : ""),
                }),
                unusedCandidate: candidate && imagePath !== candidate
                    ? candidate
                    : null,
            };
        }

        if (!unsuitablePhotoStatuses.has(result?.status)) {
            return {
                step: createStep({
                    status: result?.status ?? null,
                    error: result?.error?.message || result?.status
                        || "Не вдалося оновити фото",
                    path: imagePath,
                }),
                unusedCandidate: candidate ?? null,
            };
        }
    }

    if (!lastResult && skippedUnsuitable.length > 0) {
        return {
            step: createStep({
                skipped: true,
                reason: "Немає підходящих фото (тип або розмір)",
                detail: skippedUnsuitable.join(", "),
            }),
            unusedCandidate: candidate ?? null,
        };
    }

    return {
        step: createStep({
            status: lastResult?.status ?? null,
            error: lastResult?.error?.message || lastResult?.status
                || "Фото не підійшло",
            path: candidate ?? null,
            detail: skippedUnsuitable.length > 0
                ? `пропущено: ${skippedUnsuitable.join(", ")}`
                : null,
        }),
        unusedCandidate: candidate ?? null,
    };
}


export default async function executeCommentAccountSetupWithProfile({
    adsPower,
    profile,
    persona,
    photoSet = null,
    browserMode = "visible",
    disableImages = false,
    workerId = null,
    workerProxy = null,
    onProxyUnavailable = null,
    logger = console,
    signal,
    random = Math.random,
    skipNameChange = false,
    skipAvatarChange = false,
    skipCoverChange = false,
    skipDeletePosts = false,
    skipPublishPosts = false,
    skipFillAbout = false,
    ignoreSkipReasons = false,
    actions = {},
} = {}) {
    const profileNo = String(profile?.profile_no ?? "невідомий");
    const changeName = actions.changeName ?? changeFacebookName;
    const changeAvatar = actions.changeAvatar ?? changeFacebookProfilePicture;
    const changeCover = actions.changeCover ?? changeFacebookCoverPhoto;
    const deletePosts = actions.deletePosts
        ?? deleteAllFacebookPersonalProfilePosts;
    const publishPosts = actions.publishPosts
        ?? publishFacebookPersonalProfileMediaPostsWithDates;
    const fillAbout = actions.fillAbout ?? fillFacebookPersonalProfileAbout;
    const openPage = actions.openPage ?? openPageWithoutPopups;
    const ensureLanguage = actions.ensureEnglish ?? ensureEnglish;
    const ensureLoggedIn = actions.ensureLoggedIn
        ?? ensureFacebookAccountLoggedIn;
    const ensureActive = actions.ensureActive ?? ensureFacebookAccountActive;
    const ensureReady = actions.ensureAdsPowerReady
        ?? ensureAdsPowerProfileReady;
    const configureBrowserWindow = actions.configureBrowserWindow
        ?? configureFacebookAutomationWindow;
    const connectBrowser = actions.connectBrowser
        ?? ((browserData) => puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        }));
    const markNameError = actions.markChangeNameError
        ?? markProfileAsChangeNameError;
    const markGender = actions.markGender ?? markProfileGender;
    const updateName = actions.updateProfileName
        ?? ((id, name) => adsPower.updateProfileName(id, name));
    const renameFolder = actions.renamePhotoSet ?? renamePhotoSet;
    const adsPowerName = persona
        ? buildAdsPowerProfileName(persona)
        : null;
    const result = {
        success: false,
        outcome: "failed",
        profileNo,
        stage: "VALIDATE",
        error: null,
        skipReason: null,
        persona,
        adsPowerName,
        photoFolder: photoSet?.path ?? null,
        renamedPhotoFolder: null,
        steps: createEmptySteps(),
        cleanupErrors: [],
        aborted: false,
        skippedDueToProxy: false,
        nameChanged: false,
    };
    let browser;
    let page;
    let profileOpened = false;
    let abortCleanupPromise = null;
    let originalProxyConfig = null;
    let proxyApplied = false;
    const createAbortError = () => Object.assign(
        new Error("Оформлення акаунта перервано"),
        { name: "AbortError", code: "ACCOUNT_SETUP_ABORTED" }
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
    const closeBrowserProfileForNameRetry = async () => {
        if (browser) {
            try {
                browser.disconnect();
            } catch (error) {
                result.cleanupErrors.push(
                    `Puppeteer disconnect before name retry: ${error.message}`
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
                    `AdsPower closeProfile before name retry: ${error.message}`
                );
            }
        }
    };
    const openReadyFacebookProfile = async () => {
        assertNotAborted();
        result.stage = "OPEN_PROFILE";
        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: browserMode === "headless" ? "headless" : "visible",
            disableImages: disableImages === true,
        });
        profileOpened = true;

        assertNotAborted();
        result.stage = "CONNECT_BROWSER";
        browser = await connectBrowser(browserData);
        const pages = await browser.pages();
        page = pages[0] ?? await browser.newPage();

        assertNotAborted();
        result.stage = "CONFIGURE_BROWSER_WINDOW";
        result.browserWindow = await configureBrowserWindow(page, {
            browserMode,
        });

        assertNotAborted();
        result.stage = "OPEN_FACEBOOK";
        await openPage(page, "https://www.facebook.com/");

        assertNotAborted();
        result.stage = "FACEBOOK_LOGIN";
        const loggedIn = await ensureLoggedIn(adsPower, profile, page);
        if (!loggedIn) {
            throw new Error("Не вдалося підтвердити вхід у Facebook");
        }

        assertNotAborted();
        result.stage = "FACEBOOK_ACTIVE";
        const active = await ensureActive(adsPower, profile, page);
        if (!active) {
            throw new Error("Facebook-акаунт не активний");
        }

        assertNotAborted();
        result.stage = "ENSURE_ENGLISH";
        await ensureLanguage(page);
    };
    const handleAbort = () => {
        abortCleanupPromise ??= stopOpenedProfile();
    };
    const collectStepErrors = () => {
        const failed = Object.values(result.steps).filter((step) => (
            step && !step.ok && !step.skipped
        ));
        return failed;
    };
    const finalizeOutcome = () => {
        if (result.outcome === "skipped") return;
        if (result.aborted) {
            result.outcome = "failed";
            result.success = false;
            return;
        }
        if (!result.nameChanged) {
            result.outcome = "failed";
            result.success = false;
            return;
        }
        if (collectStepErrors().length > 0) {
            result.outcome = "completed_with_error";
            result.success = false;
            return;
        }
        result.outcome = "success";
        result.success = true;
        result.error = null;
    };

    signal?.addEventListener("abort", handleAbort, { once: true });

    try {
        assertNotAborted();
        if (!persona?.firstName || !persona?.lastName || !persona?.gender) {
            throw new Error("Не передано дані персонажа");
        }

        const skipReason = getCommentAccountSetupSkipReason(profile);
        const ignoredSkipReasons = new Set([
            commentAccountSetupSkipReasons.ALREADY_SETUP,
            commentAccountSetupSkipReasons.CHANGE_NAME_ERROR,
        ]);
        if (
            skipReason
            && !(ignoreSkipReasons && ignoredSkipReasons.has(skipReason))
        ) {
            result.outcome = "skipped";
            result.skipReason = describeCommentAccountSetupSkipReason(
                skipReason
            );
            result.stage = "SKIP";
            return result;
        }

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
                    result.outcome = "skipped";
                    result.skipReason = "Проксі воркера недоступна";
                    result.error = result.skipReason;
                    return result;
                }

                const action = await onProxyUnavailable({
                    workerId,
                    profileNo,
                    proxy: currentProxy,
                });
                if (action?.type === "replace" && action.proxy) {
                    currentProxy = action.proxy;
                    continue;
                }

                result.skippedDueToProxy = true;
                result.outcome = "skipped";
                result.skipReason = "Профіль пропущено через проксі воркера";
                result.error = result.skipReason;
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

        result.stage = "ADSPOWER_READY";
        const adsPowerReady = await ensureReady(adsPower, activeProfile);
        if (!adsPowerReady) {
            throw new Error("AdsPower-профіль не готовий до роботи");
        }

        await openReadyFacebookProfile();

        assertNotAborted();
        result.stage = "CHANGE_NAME";
        if (skipNameChange) {
            result.nameChanged = true;
            result.steps.name = createStep({
                skipped: true,
                reason: "Ім’я вже змінено, крок пропущено",
            });
        } else {
        let nameResult;
        for (
            let restartAttempt = 0;
            restartAttempt <= MAX_NAME_PROFILE_RESTARTS;
            restartAttempt += 1
        ) {
            nameResult = await changeName(page, {
                firstName: persona.firstName,
                lastName: persona.lastName,
                logger,
            });
            const shouldRestart = !nameResult?.success
                && restartAttempt < MAX_NAME_PROFILE_RESTARTS
                && restartableNameChangeErrorCodes.has(nameResult?.error?.code);
            if (!shouldRestart) break;

            result.stage = "RESTART_PROFILE_FOR_NAME";
            logger.info?.(
                "facebook.name_change.profile_restart",
                "Форма зміни імені не відкрилася; перезапускаємо профіль для єдиної повторної спроби",
                { profileNo, restartAttempt: restartAttempt + 1 }
            );
            await closeBrowserProfileForNameRetry();
            await waitHuman("long", { random });
            await openReadyFacebookProfile();
        }
        if (nameResult?.success) {
            result.nameChanged = true;
            result.steps.name = createStep({
                ok: true,
                status: nameResult.status,
                detail: `змінено на ${persona.firstName} ${persona.lastName}`,
            });
        } else {
            result.steps.name = createStep({
                status: nameResult?.status ?? null,
                error: nameResult?.error?.message
                    || nameResult?.status
                    || "Не вдалося змінити ім’я",
            });
            if (
                nameResult?.status
                !== facebookNameChangeStatuses.NAME_BUTTON_FAILED
            ) {
                try {
                    await markNameError(adsPower, profile);
                } catch (error) {
                    result.cleanupErrors.push(
                        `Change Name Error tag: ${error.message}`
                    );
                }
            }
            result.error = result.steps.name.error;
            return result;
        }
        }

        assertNotAborted();
        result.stage = "OPEN_PROFILE_PAGE";
        await openPage(page, FACEBOOK_ME_URL);

        const classified = classifyPhotoFiles(photoSet?.files ?? []);
        const usedPaths = new Set();
        const fallbackPool = [...classified.rest];

        if (classified.all.length === 0) {
            result.steps.avatar = createStep({
                skipped: true,
                reason: "Немає фото",
            });
            result.steps.cover = createStep({
                skipped: true,
                reason: "Немає фото",
            });
            result.steps.posts = createStep({
                skipped: true,
                reason: "Немає фото",
            });
        } else if (skipAvatarChange && skipCoverChange) {
            result.steps.avatar = createStep({
                ok: true,
                skipped: true,
                reason: "Аватар уже змінено, крок пропущено",
            });
            result.steps.cover = createStep({
                ok: true,
                skipped: true,
                reason: "Обкладинку вже змінено, крок пропущено",
            });
        } else {
            assertNotAborted();
            result.stage = "CHANGE_AVATAR";
            if (skipAvatarChange) {
                result.steps.avatar = createStep({
                    ok: true,
                    skipped: true,
                    reason: "Аватар уже змінено, крок пропущено",
                });
            } else {
                await waitHuman("long", { random });
                const avatarAttempt = await tryProfilePhoto({
                    changeFn: changeAvatar,
                    page,
                    candidate: classified.avatarCandidate,
                    fallbackPool,
                    usedPaths,
                    logger,
                    role: "avatar",
                });
                result.steps.avatar = avatarAttempt.step;
                if (avatarAttempt.unusedCandidate) {
                    fallbackPool.push(avatarAttempt.unusedCandidate);
                }
            }

            assertNotAborted();
            result.stage = "CHANGE_COVER";
            if (skipCoverChange) {
                result.steps.cover = createStep({
                    ok: true,
                    skipped: true,
                    reason: "Обкладинку вже змінено, крок пропущено",
                });
            } else {
                await waitHuman("long", { random });
                const coverAttempt = await tryProfilePhoto({
                    changeFn: changeCover,
                    page,
                    candidate: classified.coverCandidate,
                    fallbackPool,
                    usedPaths,
                    logger,
                    role: "cover",
                });
                result.steps.cover = coverAttempt.step;
                if (
                    coverAttempt.unusedCandidate
                    && !fallbackPool.includes(coverAttempt.unusedCandidate)
                ) {
                    fallbackPool.push(coverAttempt.unusedCandidate);
                }
            }
        }

        assertNotAborted();
        result.stage = "DELETE_POSTS";
        if (skipDeletePosts) {
            result.steps.deletePosts = createStep({
                ok: true,
                skipped: true,
                reason: "Видалення постів пропущено",
            });
        } else {
        const deleteResult = await deletePosts(page, { logger });
        if (acceptedDeleteStatuses.has(deleteResult?.status)) {
            result.steps.deletePosts = createStep({
                ok: true,
                status: deleteResult.status,
                detail: deleteResult.status
                    === facebookPersonalProfilePostDeletionStatuses.NO_POSTS
                    ? "постів не було"
                    : "старі пости видалено",
            });
        } else {
            result.steps.deletePosts = createStep({
                status: deleteResult?.status ?? null,
                error: deleteResult?.error?.message
                    || deleteResult?.status
                    || "Не вдалося видалити пости",
            });
        }
        }

        if (skipPublishPosts) {
            result.steps.posts = createStep({
                ok: true,
                skipped: true,
                reason: "Публікацію постів пропущено",
            });
        } else {
        const postFiles = classified.all.filter((filePath) => (
            !usedPaths.has(filePath)
        ));
        if (classified.all.length > 0 && postFiles.length === 0) {
            result.steps.posts = createStep({
                skipped: true,
                reason: "Усі фото пішли на аватар і обкладинку",
            });
        } else if (postFiles.length > 0) {
            assertNotAborted();
            result.stage = "OPEN_PROFILE_PAGE_FOR_POSTS";
            await openPage(page, FACEBOOK_ME_URL);
            result.stage = "PUBLISH_POSTS";
            const dates = createRandomPostDates(postFiles.length, { random });
            const posts = postFiles.map((filePath, index) => ({
                mediaPaths: [filePath],
                targetDate: dates[index],
            }));
            const postsResult = await publishPosts(page, {
                posts,
                logger,
            });
            if (postsResult?.success) {
                result.steps.posts = createStep({
                    ok: true,
                    status: postsResult.status,
                    detail: `${postsResult.publishedCount} фото, дати ${
                        dates.join(", ")
                    }`,
                });
            } else {
                result.steps.posts = createStep({
                    status: postsResult?.status ?? null,
                    error: postsResult?.error?.message
                        || postsResult?.status
                        || "Не вдалося опублікувати пости",
                    detail: postsResult
                        ? `опубліковано ${postsResult.publishedCount} з ${
                            postsResult.requestedCount
                        }`
                        : null,
                });
            }
        }
        }

        assertNotAborted();
        result.stage = "OPEN_PROFILE_PAGE_FOR_ABOUT";
        if (skipFillAbout) {
            result.steps.about = createStep({
                ok: true,
                skipped: true,
                reason: "About пропущено",
            });
        } else {
        await openPage(page, FACEBOOK_ME_URL);
        result.stage = "FILL_ABOUT";
        const aboutResult = await fillAbout(page, {
            fields: {
                bio: persona.bio,
                work: persona.work,
                education: persona.education,
            },
            logger,
        });
        if (aboutResult?.success) {
            result.steps.about = createStep({
                ok: true,
                status: aboutResult.status,
                detail: [
                    persona.bio,
                    `${persona.work?.position} @ ${persona.work?.company}`,
                    persona.education,
                ].filter(Boolean).join("; "),
            });
        } else {
            result.steps.about = createStep({
                status: aboutResult?.status ?? null,
                error: aboutResult?.error?.message
                    || aboutResult?.status
                    || "Не вдалося заповнити About",
            });
        }
        }
    } catch (error) {
        result.error = signal?.aborted
            ? "Оформлення акаунта перервано"
            : error.message;
        result.aborted = signal?.aborted || error?.name === "AbortError";
    } finally {
        signal?.removeEventListener("abort", handleAbort);
        if (abortCleanupPromise) await abortCleanupPromise;
        await stopOpenedProfile();

        if (result.nameChanged) {
            try {
                await updateName(profile.profile_id, adsPowerName);
                result.steps.adsPowerRename = createStep({
                    ok: true,
                    detail: adsPowerName,
                });
            } catch (error) {
                result.steps.adsPowerRename = createStep({
                    error: error.message,
                });
            }

            try {
                await markGender(adsPower, profile, persona.gender);
                result.steps.genderTag = createStep({
                    ok: true,
                    detail: persona.gender === "female" ? "Woman" : "Man",
                });
            } catch (error) {
                result.steps.genderTag = createStep({
                    error: error.message,
                });
            }

            if (photoSet?.path) {
                try {
                    const renamedPath = await renameFolder(
                        photoSet.path,
                        profileNo
                    );
                    result.renamedPhotoFolder = renamedPath;
                    result.steps.photoFolderRename = createStep({
                        ok: true,
                        detail: `${path.basename(photoSet.path)} → ${
                            path.basename(renamedPath)
                        }`,
                        path: renamedPath,
                    });
                } catch (error) {
                    result.steps.photoFolderRename = createStep({
                        error: error.message,
                        path: photoSet.path,
                    });
                }
            } else {
                result.steps.photoFolderRename = createStep({
                    skipped: true,
                    reason: "Немає папки фото",
                });
            }
        }

        finalizeOutcome();
    }

    return result;
}
