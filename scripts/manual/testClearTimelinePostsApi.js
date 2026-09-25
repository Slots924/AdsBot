import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import captureGraphqlPayload
    from "../../facebook/api-actions/captureGraphqlPayload.js";
import getManagePosts
    from "../../facebook/api-actions/posts/getManagePosts.js";
import deletePost
    from "../../facebook/api-actions/posts/deletePost.js";
import getPostHideContext
    from "../../facebook/api-actions/posts/getPostHideContext.js";
import hidePostFromTimeline
    from "../../facebook/api-actions/posts/hidePostFromTimeline.js";
import ensureAdsPowerProfileReady
    from "../../workflows/profile/ensureAdsPowerProfileReady.js";


const profileNo = 1880;
const actionTimeout = 30000;


// Видаляє звичайні пости послідовно, щоб окремо зафіксувати результат кожного запиту.
async function deleteRegularPosts(page, commonPayload, posts) {
    const regularPosts = posts.filter((post) => !post.isSystem && post.canDelete);
    const skippedPosts = posts.filter((post) => !post.isSystem && !post.canDelete);
    const deletionResults = [];

    console.log("[MANAGE-POSTS-TEST] Звичайні пости для видалення", {
        eligible: regularPosts.length,
        skipped: skippedPosts.length,
    });

    for (const [index, post] of regularPosts.entries()) {
        const position = `${index + 1}/${regularPosts.length}`;
        console.log(`[MANAGE-POSTS-TEST] Видаляємо пост ${position}`, {
            storyId: post.storyId,
            creationTime: post.creationTime,
        });

        const result = await deletePost({
            page,
            commonPayload,
            storyId: post.storyId,
            clientMutationId: String(index + 1),
            timeout: actionTimeout,
        });
        deletionResults.push({ post, result });

        console.log(`[MANAGE-POSTS-TEST] deletePost ${position}: ${result.status}`);
        if (!result.success) {
            logActionError(`deletePost (${position})`, result);
        }
    }

    return {
        deletionResults,
        skippedPosts,
    };
}


// Приховує системні пости послідовно, отримуючи новий context для кожного story.
async function hideSystemPosts(page, commonPayload, posts, clientMutationIdStart) {
    const systemPosts = posts.filter((post) => post.isSystem);
    const hideResults = [];

    console.log("[MANAGE-POSTS-TEST] Системні пости для приховування", {
        eligible: systemPosts.length,
    });

    for (const [index, post] of systemPosts.entries()) {
        const position = `${index + 1}/${systemPosts.length}`;
        console.log(`[MANAGE-POSTS-TEST] Отримуємо hide-context для системного поста ${position}`, {
            storyId: post.storyId,
            systemType: post.systemType,
        });

        const contextResult = await getPostHideContext({
            page,
            commonPayload,
            storyId: post.storyId,
            timeout: actionTimeout,
        });
        console.log(`[MANAGE-POSTS-TEST] getPostHideContext ${position}: ${contextResult.status}`);
        if (!contextResult.success || !contextResult.data?.hideAvailable) {
            if (!contextResult.success) {
                logActionError(`getPostHideContext (${position})`, contextResult);
            }
            hideResults.push({ post, contextResult, hideResult: null });
            continue;
        }

        console.log(`[MANAGE-POSTS-TEST] Приховуємо системний пост ${position}`);
        const hideResult = await hidePostFromTimeline({
            page,
            commonPayload,
            context: contextResult.data.context,
            clientMutationId: String(clientMutationIdStart + index),
            timeout: actionTimeout,
        });
        hideResults.push({ post, contextResult, hideResult });

        console.log(`[MANAGE-POSTS-TEST] hidePostFromTimeline ${position}: ${hideResult.status}`);
        if (!hideResult.success) {
            logActionError(`hidePostFromTimeline (${position})`, hideResult);
        }
    }

    return hideResults;
}


// Друкує помилку action без session-параметрів Facebook.
function logActionError(actionName, result) {
    console.error(`\n[MANAGE-POSTS-TEST] Помилка ${actionName}:`);
    console.dir(result?.data?.errors ?? result, {
        depth: null,
        colors: true,
    });
}


async function main() {
    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    console.log("=".repeat(72));
    console.log("РУЧНИЙ ТЕСТ ВИДАЛЕННЯ ЗВИЧАЙНИХ FACEBOOK POSTS ЧЕРЕЗ MANAGE POSTS API");
    console.log("=".repeat(72));

    try {
        console.log(`[MANAGE-POSTS-TEST] Отримуємо AdsPower-профіль ${profileNo}`);
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile) throw new Error(`AdsPower-профіль ${profileNo} не знайдено`);
        if (!await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error("AdsPower-профіль не готовий до запуску");
        }

        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
        });
        profileOpened = true;
        browser = await puppeteer.connect({
            browserWSEndpoint: browserData.ws.puppeteer,
            defaultViewport: null,
        });
        const page = (await browser.pages())[0] ?? await browser.newPage();

        console.log("[MANAGE-POSTS-TEST] Захоплюємо актуальний Facebook GraphQL request");
        const payloadResult = await captureGraphqlPayload(page, {
            timeout: actionTimeout,
        });
        console.log(`[MANAGE-POSTS-TEST] captureGraphqlPayload: ${payloadResult.status}`);
        if (!payloadResult.success) {
            logActionError("captureGraphqlPayload", payloadResult);
            throw new Error(payloadResult.error ?? payloadResult.status);
        }

        console.log("[MANAGE-POSTS-TEST] Отримуємо максимальну кількість постів через Manage Posts");
        const result = await getManagePosts({
            page,
            commonPayload: payloadResult.data,
            timeout: actionTimeout,
        });
        console.log(`[MANAGE-POSTS-TEST] getManagePosts: ${result.status}`, {
            received: result.data?.posts?.length ?? 0,
            pagesLoaded: result.data?.pagesLoaded ?? 0,
            hasNextPage: result.data?.pageInfo?.hasNextPage ?? null,
        });
        if (!result.success) {
            logActionError("getManagePosts", result);
            throw new Error(result.status);
        }

        const { posts } = result.data;
        const summary = {
            total: posts.length,
            avatarPosts: posts.filter((post) => post.systemType === "AVATAR").length,
            coverPosts: posts.filter((post) => post.systemType === "COVER").length,
            regularPosts: posts.filter((post) => !post.isSystem).length,
        };
        console.log("[MANAGE-POSTS-TEST] Отримано всі пости, доступні цьому запиту", {
            ...summary,
            pagesLoaded: result.data.pagesLoaded,
            hasNextPage: result.data.pageInfo.hasNextPage,
        });
        console.table(posts.map((post) => ({
            storyId: post.storyId,
            systemType: post.systemType ?? "REGULAR",
            canDelete: post.canDelete,
            canHide: post.canHide,
            creationTime: post.creationTime,
        })));

        const { deletionResults, skippedPosts } = await deleteRegularPosts(
            page,
            payloadResult.data,
            posts
        );
        const failedDeletions = deletionResults.filter(({ result: deletionResult }) => !deletionResult.success);
        console.log("[MANAGE-POSTS-TEST] Підсумок видалення звичайних постів", {
            attempted: deletionResults.length,
            deleted: deletionResults.length - failedDeletions.length,
            failed: failedDeletions.length,
            skipped: skippedPosts.length,
        });

        if (failedDeletions.length) {
            process.exitCode = 1;
        }

        const hideResults = await hideSystemPosts(
            page,
            payloadResult.data,
            posts,
            deletionResults.length + 1
        );
        const failedHides = hideResults.filter(({ contextResult, hideResult }) => (
            !contextResult.success
            || !contextResult.data?.hideAvailable
            || !hideResult?.success
        ));
        console.log("[MANAGE-POSTS-TEST] Підсумок приховування системних постів", {
            attempted: hideResults.length,
            hidden: hideResults.length - failedHides.length,
            failed: failedHides.length,
        });

        if (failedHides.length) {
            process.exitCode = 1;
        }
    } catch (error) {
        console.error("\n[MANAGE-POSTS-TEST] Помилка ручного тесту:");
        console.error(error.stack ?? error.message ?? error);
        process.exitCode = 1;
    } finally {
        if (browser) browser.disconnect();
        if (profileOpened) {
            console.log(`[MANAGE-POSTS-TEST] AdsPower-профіль ${profileNo} залишено відкритим для перевірки.`);
        }
        console.log("=".repeat(72));
    }
}


main();
