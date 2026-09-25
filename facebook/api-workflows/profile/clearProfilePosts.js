import getManagePosts from "../../api-actions/posts/getManagePosts.js";
import deletePost from "../../api-actions/posts/deletePost.js";
import getPostHideContext from "../../api-actions/posts/getPostHideContext.js";
import hidePostFromTimeline from "../../api-actions/posts/hidePostFromTimeline.js";


export const clearProfilePostsStatuses = Object.freeze({
    CLEARED: "CLEARED",
    NO_POSTS: "NO_POSTS",
    PARTIAL: "PARTIAL",
    GET_POSTS_FAILED: "GET_POSTS_FAILED",
    ERROR: "ERROR",
});


function createResult(success, status, data = {}, extra = {}) {
    return { success, status, ...data, ...extra };
}


// Послідовно видаляє звичайні пости та приховує системні пости аватарки й обкладинки.
export default async function clearProfilePosts({
    page,
    commonPayload,
    timeout,
    maxPasses = 3,
} = {}) {
    const deletedStoryIds = new Set();
    const hiddenStoryIds = new Set();
    const failures = [];

    try {
        for (let pass = 1; pass <= maxPasses; pass += 1) {
            const postsResult = await getManagePosts({
                page,
                commonPayload,
                timeout,
                omitPinnedPost: false,
            });
            if (!postsResult.success) {
                return createResult(false, clearProfilePostsStatuses.GET_POSTS_FAILED, {
                    deletedCount: deletedStoryIds.size,
                    hiddenCount: hiddenStoryIds.size,
                    failedCount: failures.length,
                    failures,
                }, {
                    actionStatus: postsResult.status,
                    error: postsResult.error ?? postsResult.status,
                });
            }

            const posts = Array.isArray(postsResult.data?.posts)
                ? postsResult.data.posts
                : [];
            const pending = posts.filter((post) => (
                !deletedStoryIds.has(post.storyId)
                && !hiddenStoryIds.has(post.storyId)
            ));
            if (posts.length === 0) {
                const changedCount = deletedStoryIds.size + hiddenStoryIds.size;
                return createResult(
                    true,
                    changedCount
                        ? clearProfilePostsStatuses.CLEARED
                        : clearProfilePostsStatuses.NO_POSTS,
                    {
                        deletedCount: deletedStoryIds.size,
                        hiddenCount: hiddenStoryIds.size,
                        failedCount: 0,
                        remainingCount: 0,
                        failures: [],
                    }
                );
            }

            if (pending.length === 0) continue;

            for (const post of pending) {
                const clientMutationId = String(
                    deletedStoryIds.size + hiddenStoryIds.size + failures.length + 1
                );

                if (post.isSystem && post.canHide) {
                    const contextResult = await getPostHideContext({
                        page,
                        commonPayload,
                        storyId: post.storyId,
                        timeout,
                    });
                    if (!contextResult.success || !contextResult.data?.context) {
                        failures.push({
                            storyId: post.storyId,
                            operation: "HIDE_CONTEXT",
                            status: contextResult.status,
                        });
                        continue;
                    }

                    const hideResult = await hidePostFromTimeline({
                        page,
                        commonPayload,
                        context: contextResult.data.context,
                        clientMutationId,
                        timeout,
                    });
                    if (hideResult.success) {
                        hiddenStoryIds.add(post.storyId);
                    } else {
                        failures.push({
                            storyId: post.storyId,
                            operation: "HIDE",
                            status: hideResult.status,
                        });
                    }
                    continue;
                }

                if (!post.isSystem && post.canDelete) {
                    const deleteResult = await deletePost({
                        page,
                        commonPayload,
                        storyId: post.storyId,
                        clientMutationId,
                        timeout,
                    });
                    if (deleteResult.success) {
                        deletedStoryIds.add(post.storyId);
                    } else {
                        failures.push({
                            storyId: post.storyId,
                            operation: "DELETE",
                            status: deleteResult.status,
                        });
                    }
                    continue;
                }

                failures.push({
                    storyId: post.storyId,
                    operation: "UNSUPPORTED",
                    status: "POST_CANNOT_BE_DELETED_OR_HIDDEN",
                });
            }
        }

        const finalResult = await getManagePosts({
            page,
            commonPayload,
            timeout,
            omitPinnedPost: false,
        });
        const remainingPosts = finalResult.success && Array.isArray(finalResult.data?.posts)
            ? finalResult.data.posts
            : [];
        if (finalResult.success && remainingPosts.length === 0) {
            const changedCount = deletedStoryIds.size + hiddenStoryIds.size;
            return createResult(true, changedCount
                ? clearProfilePostsStatuses.CLEARED
                : clearProfilePostsStatuses.NO_POSTS, {
                deletedCount: deletedStoryIds.size,
                hiddenCount: hiddenStoryIds.size,
                failedCount: 0,
                remainingCount: 0,
                failures: [],
            });
        }
        return createResult(false, clearProfilePostsStatuses.PARTIAL, {
            deletedCount: deletedStoryIds.size,
            hiddenCount: hiddenStoryIds.size,
            failedCount: failures.length,
            remainingCount: remainingPosts.length,
            failures,
        }, {
            error: "Не вдалося очистити таймлайн за дозволену кількість проходів",
        });
    } catch (error) {
        return createResult(false, clearProfilePostsStatuses.ERROR, {
            deletedCount: deletedStoryIds.size,
            hiddenCount: hiddenStoryIds.size,
            failedCount: failures.length,
            failures,
        }, {
            error: String(error?.message ?? error),
        });
    }
}
