import changeFacebookPersonalProfilePostDate, {
    parseFacebookPersonalProfilePostDate,
} from "./changeFacebookPersonalProfilePostDate.js";
import publishFacebookPersonalProfileMediaPost from "./publishFacebookPersonalProfileMediaPost.js";


export const facebookPersonalProfilePostsWithDatesStatuses = Object.freeze({
    COMPLETED: "COMPLETED",
    INVALID_INPUT: "INVALID_INPUT",
    PUBLISH_PARTIAL: "PUBLISH_PARTIAL",
    POST_URL_CAPTURE_FAILED: "POST_URL_CAPTURE_FAILED",
    DATE_CHANGE_PARTIAL: "DATE_CHANGE_PARTIAL",
    ERROR: "ERROR",
});


function emitLog(logger, level, event, message, fields = {}) {
    const method = logger?.[level];
    if (typeof method !== "function") return;

    try {
        if (typeof logger.child === "function") {
            method.call(logger, event, message, fields);
            return;
        }
        method.call(
            logger,
            `[publishFacebookPersonalProfileMediaPostsWithDates] `
            + `[${fields.stage ?? "UNKNOWN"}] ${message}`,
            fields
        );
    } catch {
        // Помилка logger не повинна зупиняти Facebook action.
    }
}


async function emitProgress(onProgress, event) {
    if (typeof onProgress !== "function") return;

    try {
        await onProgress(event);
    } catch {
        // Зовнішній progress callback не повинен зупиняти Facebook action.
    }
}


function validatePosts(posts) {
    if (!Array.isArray(posts) || posts.length === 0) return null;

    const normalized = [];
    for (const [index, post] of posts.entries()) {
        if (
            !post
            || !Array.isArray(post.mediaPaths)
            || post.mediaPaths.length === 0
        ) {
            return null;
        }
        const target = parseFacebookPersonalProfilePostDate(
            post.targetDate ?? post.date
        );
        if (!target) return null;

        normalized.push({
            sequence: index + 1,
            mediaPaths: [...post.mediaPaths],
            targetDate: target.isoDate,
            inputDate: target.inputDate,
        });
    }
    return normalized;
}


export default async function publishFacebookPersonalProfileMediaPostsWithDates(
    page,
    {
        posts,
        timeout = 90000,
        random = Math.random,
        sleep,
        logger = console,
        onProgress = null,
    } = {}
) {
    const startedAt = new Date().toISOString();
    const normalizedPosts = validatePosts(posts);
    let stage = "VALIDATE_INPUT";
    let status = facebookPersonalProfilePostsWithDatesStatuses.ERROR;
    let errorDetails = null;
    let datePhaseStarted = false;
    const items = normalizedPosts?.map((post) => ({
        ...post,
        publishedAt: null,
        postId: null,
        postUrl: null,
        publishStatus: "PENDING",
        publishResult: null,
        dateChangeStatus: "PENDING",
        dateChangeResult: null,
        error: null,
    })) ?? [];
    const report = (event, message, fields = {}, level = "info") => emitLog(
        logger,
        level,
        event,
        message,
        {
            stage,
            currentUrl: typeof page?.url === "function" ? page.url() : null,
            ...fields,
        }
    );

    try {
        if (!page || typeof page.url !== "function" || !normalizedPosts) {
            status = facebookPersonalProfilePostsWithDatesStatuses.INVALID_INPUT;
            throw new Error(
                "Потрібна Puppeteer-сторінка та непорожній posts із mediaPaths і targetDate"
            );
        }

        report("facebook.personal_posts_with_dates.started", "Починаємо двофазну публікацію постів", {
            postCount: items.length,
        });

        stage = "PUBLISH_ALL";
        for (const item of items) {
            report("facebook.personal_posts_with_dates.publish.started", "Публікуємо пост", {
                sequence: item.sequence,
                mediaCount: item.mediaPaths.length,
                targetDate: item.targetDate,
            });
            await emitProgress(onProgress, {
                type: "post_publish_started",
                sequence: item.sequence,
                total: items.length,
            });

            const publishResult = await publishFacebookPersonalProfileMediaPost(
                page,
                {
                    mediaPaths: item.mediaPaths,
                    timeout,
                    random,
                    ...(sleep ? { sleep } : {}),
                    capturePostUrl: true,
                }
            );
            item.publishResult = publishResult;
            item.publishStatus = publishResult.status;
            item.publishedAt = publishResult.success
                ? publishResult.finishedAt
                : null;
            item.postId = publishResult.postId ?? null;
            item.postUrl = publishResult.postUrl ?? null;
            if (!publishResult.success || !publishResult.postUrl) {
                item.error = publishResult.error ?? {
                    code: "FACEBOOK_PERSONAL_POST_URL_NOT_CAPTURED",
                    message: "Пост опубліковано, але точний URL не знайдено",
                };
            }

            report(
                "facebook.personal_posts_with_dates.publish.finished",
                publishResult.success
                    ? "Публікацію поста завершено"
                    : "Не вдалося опублікувати пост",
                {
                    sequence: item.sequence,
                    publishStatus: item.publishStatus,
                    postUrl: item.postUrl,
                    postId: item.postId,
                    error: item.error,
                },
                publishResult.success && item.postUrl ? "info" : "error"
            );
            await emitProgress(onProgress, {
                type: "post_publish_finished",
                sequence: item.sequence,
                total: items.length,
                success: publishResult.success,
                postUrl: item.postUrl,
            });
        }

        const publishFailures = items.filter((item) =>
            !item.publishResult?.success
        );
        const missingUrls = items.filter((item) =>
            item.publishResult?.success && !item.postUrl
        );

        if (publishFailures.length > 0) {
            status = facebookPersonalProfilePostsWithDatesStatuses.PUBLISH_PARTIAL;
            for (const item of items) {
                if (item.dateChangeStatus === "PENDING") {
                    item.dateChangeStatus = "SKIPPED_PUBLISH_INCOMPLETE";
                }
            }
            return buildResult();
        }
        if (missingUrls.length > 0) {
            status = facebookPersonalProfilePostsWithDatesStatuses
                .POST_URL_CAPTURE_FAILED;
            for (const item of items) {
                if (item.dateChangeStatus === "PENDING") {
                    item.dateChangeStatus = "SKIPPED_URL_INCOMPLETE";
                }
            }
            return buildResult();
        }

        stage = "CHANGE_ALL_DATES";
        datePhaseStarted = true;
        report("facebook.personal_posts_with_dates.date_phase.started", "Усі пости опубліковані; починаємо фазу зміни дат", {
            postCount: items.length,
        });
        await emitProgress(onProgress, {
            type: "date_change_phase_started",
            total: items.length,
        });

        for (const item of items) {
            report("facebook.personal_posts_with_dates.date.started", "Змінюємо дату точного поста", {
                sequence: item.sequence,
                postUrl: item.postUrl,
                targetDate: item.targetDate,
            });
            const dateChangeResult = await changeFacebookPersonalProfilePostDate(
                page,
                {
                    postUrl: item.postUrl,
                    targetDate: item.targetDate,
                    timeout,
                    random,
                    ...(sleep ? { sleep } : {}),
                    logger,
                    onProgress,
                    closePostDialog: true,
                }
            );
            item.dateChangeResult = dateChangeResult;
            item.dateChangeStatus = dateChangeResult.status;
            if (!dateChangeResult.success) {
                item.error = dateChangeResult.error;
            }
            report(
                "facebook.personal_posts_with_dates.date.finished",
                dateChangeResult.success
                    ? "Дату поста змінено й перевірено"
                    : "Не вдалося змінити дату поста",
                {
                    sequence: item.sequence,
                    postUrl: item.postUrl,
                    dateChangeStatus: item.dateChangeStatus,
                    verified: dateChangeResult.verified,
                    error: item.error,
                },
                dateChangeResult.success ? "info" : "error"
            );
        }

        status = items.every((item) => item.dateChangeResult?.success)
            ? facebookPersonalProfilePostsWithDatesStatuses.COMPLETED
            : facebookPersonalProfilePostsWithDatesStatuses.DATE_CHANGE_PARTIAL;
    } catch (error) {
        if (status === facebookPersonalProfilePostsWithDatesStatuses.ERROR) {
            status = stage === "VALIDATE_INPUT"
                ? facebookPersonalProfilePostsWithDatesStatuses.INVALID_INPUT
                : facebookPersonalProfilePostsWithDatesStatuses.ERROR;
        }
        errorDetails = {
            code: error.code
                ?? `FACEBOOK_PERSONAL_POSTS_WITH_DATES_${stage}_FAILED`,
            message: error.message,
        };
        report("facebook.personal_posts_with_dates.failed", error.message, {
            status,
            error: errorDetails,
        }, "error");
    }

    return buildResult();

    function buildResult() {
        const publishedCount = items.filter((item) =>
            item.publishResult?.success
        ).length;
        const capturedUrlCount = items.filter((item) => item.postUrl).length;
        const dateChangedCount = items.filter((item) =>
            item.dateChangeResult?.success
        ).length;
        const success = status
            === facebookPersonalProfilePostsWithDatesStatuses.COMPLETED;
        const result = {
            success,
            status,
            stage: success ? "COMPLETED" : stage,
            requestedCount: items.length,
            publishedCount,
            capturedUrlCount,
            dateChangedCount,
            datePhaseStarted,
            items,
            startedAt,
            finishedAt: new Date().toISOString(),
            finalUrl: typeof page?.url === "function" ? page.url() : null,
            error: errorDetails,
        };
        report(
            success
                ? "facebook.personal_posts_with_dates.completed"
                : "facebook.personal_posts_with_dates.partial",
            success
                ? "Усі пости опубліковано, їхні дати змінено й перевірено"
                : "Двофазну обробку завершено не повністю",
            {
                status,
                publishedCount,
                capturedUrlCount,
                dateChangedCount,
                datePhaseStarted,
            },
            success ? "info" : "error"
        );
        return result;
    }
}
