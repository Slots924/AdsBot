import { waitHuman } from "../browser/timing.js";
import changeFacebookPersonalProfilePostDate, {
    parseFacebookPersonalProfilePostDate,
} from "./changeFacebookPersonalProfilePostDate.js";
import {
    extractFacebookFeedPostId,
    normalizeFacebookFeedPostUrl,
    readFirstFeedPostFingerprint,
    waitForFirstFeedPostChange,
} from "./openFacebookPersonalProfileFirstFeedPost.js";
import publishFacebookPersonalProfileMediaPost from "./publishFacebookPersonalProfileMediaPost.js";


export const facebookPersonalProfilePostsWithDatesStatuses = Object.freeze({
    COMPLETED: "COMPLETED",
    INVALID_INPUT: "INVALID_INPUT",
    PUBLISH_PARTIAL: "PUBLISH_PARTIAL",
    POST_URL_CAPTURE_FAILED: "POST_URL_CAPTURE_FAILED",
    FIRST_FEED_POST_OPEN_FAILED: "FIRST_FEED_POST_OPEN_FAILED",
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


function skipPendingDates(items, status) {
    for (const item of items) {
        if (item.dateChangeStatus === "PENDING") {
            item.dateChangeStatus = status;
        }
    }
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
    const timingOptions = { random, ...(sleep ? { sleep } : {}) };
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

        report(
            "facebook.personal_posts_with_dates.started",
            "Починаємо публікацію постів і зміну дат по одному",
            {
                postCount: items.length,
            }
        );

        for (const item of items) {
            stage = "PUBLISH";
            const previousFingerprint = await readFirstFeedPostFingerprint(
                page
            );
            report(
                "facebook.personal_posts_with_dates.publish.started",
                "Публікуємо пост",
                {
                    sequence: item.sequence,
                    mediaCount: item.mediaPaths.length,
                    targetDate: item.targetDate,
                    previousFingerprint,
                }
            );
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
                    capturePostUrl: false,
                    logger,
                }
            );
            item.publishResult = publishResult;
            item.publishStatus = publishResult.status;
            item.publishedAt = publishResult.success
                ? publishResult.finishedAt
                : null;
            item.postId = publishResult.postId ?? null;
            item.postUrl = publishResult.postUrl ?? null;

            report(
                "facebook.personal_posts_with_dates.publish.finished",
                publishResult.success
                    ? "Публікацію поста завершено"
                    : "Не вдалося опублікувати пост",
                {
                    sequence: item.sequence,
                    publishStatus: item.publishStatus,
                    error: publishResult.error,
                },
                publishResult.success ? "info" : "error"
            );
            await emitProgress(onProgress, {
                type: "post_publish_finished",
                sequence: item.sequence,
                total: items.length,
                success: publishResult.success,
                postUrl: item.postUrl,
            });

            if (!publishResult.success) {
                item.error = publishResult.error;
                status = facebookPersonalProfilePostsWithDatesStatuses
                    .PUBLISH_PARTIAL;
                skipPendingDates(items, "SKIPPED_PUBLISH_INCOMPLETE");
                return buildResult();
            }

            await waitHuman("short", timingOptions);

            stage = "WAIT_FEED_POST";
            report(
                "facebook.personal_posts_with_dates.feed.wait",
                "Чекаємо нову першу картку стрічки",
                {
                    sequence: item.sequence,
                    previousFingerprint,
                }
            );
            await emitProgress(onProgress, {
                type: "first_feed_post_ready_started",
                sequence: item.sequence,
                total: items.length,
            });

            try {
                await waitForFirstFeedPostChange(
                    page,
                    previousFingerprint,
                    timeout
                );
            } catch (error) {
                item.error = {
                    code: "FACEBOOK_PERSONAL_FIRST_FEED_POST_OPEN_FAILED",
                    message: "Перша картка стрічки не з’явилась або не змінилася",
                };
                status = facebookPersonalProfilePostsWithDatesStatuses
                    .FIRST_FEED_POST_OPEN_FAILED;
                item.dateChangeStatus = "SKIPPED_OPEN_FAILED";
                skipPendingDates(items, "SKIPPED_OPEN_INCOMPLETE");
                report(
                    "facebook.personal_posts_with_dates.feed.failed",
                    item.error.message,
                    {
                        sequence: item.sequence,
                        previousFingerprint,
                        error: item.error,
                        cause: error.message,
                    },
                    "error"
                );
                await emitProgress(onProgress, {
                    type: "first_feed_post_ready_finished",
                    sequence: item.sequence,
                    total: items.length,
                    success: false,
                    postUrl: item.postUrl,
                });
                return buildResult();
            }

            const fingerprint = await readFirstFeedPostFingerprint(page);
            const capturedUrl = normalizeFacebookFeedPostUrl(
                fingerprint.permalink || fingerprint.cft
            );
            item.postUrl = capturedUrl ?? item.postUrl;
            item.postId = extractFacebookFeedPostId(item.postUrl)
                ?? item.postId;

            report(
                "facebook.personal_posts_with_dates.feed.ready",
                "Нова картка стрічки з’явилась",
                {
                    sequence: item.sequence,
                    postUrl: item.postUrl,
                    postId: item.postId,
                    fingerprint,
                }
            );
            await emitProgress(onProgress, {
                type: "first_feed_post_ready_finished",
                sequence: item.sequence,
                total: items.length,
                success: true,
                postUrl: item.postUrl,
            });

            stage = "CHANGE_DATE";
            if (!datePhaseStarted) {
                datePhaseStarted = true;
                report(
                    "facebook.personal_posts_with_dates.date_phase.started",
                    "Починаємо зміну дати відкритого поста",
                    {
                        sequence: item.sequence,
                        postCount: items.length,
                    }
                );
                await emitProgress(onProgress, {
                    type: "date_change_phase_started",
                    total: items.length,
                    sequence: item.sequence,
                });
            }

            report(
                "facebook.personal_posts_with_dates.date.started",
                "Змінюємо дату відкритого поста",
                {
                    sequence: item.sequence,
                    postUrl: item.postUrl,
                    targetDate: item.targetDate,
                }
            );
            const dateChangeResult = await changeFacebookPersonalProfilePostDate(
                page,
                {
                    postUrl: null,
                    targetDate: item.targetDate,
                    timeout,
                    random,
                    ...(sleep ? { sleep } : {}),
                    logger,
                    onProgress,
                    closePostDialog: false,
                    fromFeed: true,
                }
            );
            item.dateChangeResult = dateChangeResult;
            item.dateChangeStatus = dateChangeResult.status;
            if (!dateChangeResult.success) {
                item.error = dateChangeResult.error;
                status = facebookPersonalProfilePostsWithDatesStatuses
                    .DATE_CHANGE_PARTIAL;
                skipPendingDates(items, "SKIPPED_DATE_INCOMPLETE");
                report(
                    "facebook.personal_posts_with_dates.date.finished",
                    "Не вдалося змінити дату поста",
                    {
                        sequence: item.sequence,
                        postUrl: item.postUrl,
                        dateChangeStatus: item.dateChangeStatus,
                        verified: dateChangeResult.verified,
                        error: item.error,
                    },
                    "error"
                );
                return buildResult();
            }

            report(
                "facebook.personal_posts_with_dates.date.finished",
                "Дату поста змінено й перевірено",
                {
                    sequence: item.sequence,
                    postUrl: item.postUrl,
                    dateChangeStatus: item.dateChangeStatus,
                    verified: dateChangeResult.verified,
                }
            );
            await waitHuman("short", timingOptions);
        }

        status = facebookPersonalProfilePostsWithDatesStatuses.COMPLETED;
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
                : "Обробку постів завершено не повністю",
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
