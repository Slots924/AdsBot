import createPublicPhotoPost
    from "../../api-actions/posts/createPublicPhotoPost.js";
import backdatePost from "../../api-actions/posts/backdatePost.js";


export const publishProfilePostsWithDatesStatuses = Object.freeze({
    COMPLETED: "COMPLETED",
    PARTIAL: "PARTIAL",
    INVALID_INPUT: "INVALID_INPUT",
    ERROR: "ERROR",
});


function parseTargetDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
    if (!match) return null;

    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() + 1 !== month
        || date.getUTCDate() !== day
    ) return null;

    return { year, month, day };
}


// Створює фото-пости послідовно та одразу змінює дату кожного створеного story.
export default async function publishProfilePostsWithDates({
    page,
    commonPayload,
    posts,
    timeout,
} = {}) {
    const normalizedPosts = Array.isArray(posts)
        ? posts.map((post) => ({
            imagePath: post?.mediaPaths?.[0] ?? null,
            targetDate: parseTargetDate(post?.targetDate ?? post?.date),
        }))
        : [];
    if (
        normalizedPosts.length === 0
        || normalizedPosts.some((post) => !post.imagePath || !post.targetDate)
    ) {
        return {
            success: false,
            status: publishProfilePostsWithDatesStatuses.INVALID_INPUT,
            publishedCount: 0,
            backdatedCount: 0,
            requestedCount: normalizedPosts.length,
            items: [],
            error: "Потрібні пости з одним фото та датою YYYY-MM-DD",
        };
    }

    const items = [];
    try {
        for (const [index, post] of normalizedPosts.entries()) {
            const createResult = await createPublicPhotoPost({
                page,
                commonPayload,
                imagePath: post.imagePath,
                timeout,
            });
            const item = {
                sequence: index + 1,
                imagePath: post.imagePath,
                targetDate: post.targetDate,
                created: createResult.success,
                createStatus: createResult.status,
                storyId: createResult.data?.storyId ?? null,
                backdated: false,
                backdateStatus: null,
            };
            items.push(item);
            if (!createResult.success || !item.storyId) continue;

            const backdateResult = await backdatePost({
                page,
                commonPayload,
                storyId: item.storyId,
                ...post.targetDate,
                hour: 12,
                minute: 0,
                clientMutationId: String(index + 1),
                timeout,
            });
            item.backdated = backdateResult.success;
            item.backdateStatus = backdateResult.status;
        }

        const publishedCount = items.filter((item) => item.created).length;
        const backdatedCount = items.filter((item) => item.backdated).length;
        const success = backdatedCount === normalizedPosts.length;
        return {
            success,
            status: success
                ? publishProfilePostsWithDatesStatuses.COMPLETED
                : publishProfilePostsWithDatesStatuses.PARTIAL,
            publishedCount,
            backdatedCount,
            requestedCount: normalizedPosts.length,
            items,
            error: success ? null : "Не всі фото-пости створено та датовано",
        };
    } catch (error) {
        return {
            success: false,
            status: publishProfilePostsWithDatesStatuses.ERROR,
            publishedCount: items.filter((item) => item.created).length,
            backdatedCount: items.filter((item) => item.backdated).length,
            requestedCount: normalizedPosts.length,
            items,
            error: String(error?.message ?? error),
        };
    }
}
