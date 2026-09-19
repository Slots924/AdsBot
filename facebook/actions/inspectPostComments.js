import {
    allEmbeddedPostCommentSelector,
    allPostCommentSelector,
    postDialogSelector,
    storyMessageSelector,
} from "../selectors/post.js";


function formatCommentLog(comment, index) {
    const level = comment.isReply ? "REPLY" : "COMMENT";
    const id = comment.id ?? "ID НЕ ЗНАЙДЕНО";
    const parentId = comment.parentId ?? "—";

    return `${String(index + 1).padStart(2, "0")}. [${level}] id=${id} parentId=${parentId}`;
}


/**
 * Знаходить видимі коментарі поточного поста та повертає їхні ID.
 * Екшен нічого не натискає та не змінює стан Facebook.
 */
export default async function inspectPostComments(
    page,
    { targetCommentId = null } = {}
) {
    try {
        const result = await page.evaluate(
            ({ dialogSelector, storySelector, embeddedCommentSelector, modalCommentSelector }) => {
                const normalize = (value) => String(value ?? "")
                    .replace(/\s+/g, " ")
                    .trim();
                const visible = (element) => {
                    const rect = element.getBoundingClientRect();
                    const styles = window.getComputedStyle(element);

                    return rect.width > 0
                        && rect.height > 0
                        && styles.display !== "none"
                        && styles.visibility !== "hidden";
                };
                const getPostRoot = (storyMessage) => {
                    let element = storyMessage;

                    while (element && element !== document.body) {
                        if (
                            element.querySelector('[data-ad-rendering-role="profile_name"]')
                            && element.querySelector('[data-ad-rendering-role="story_message"]')
                            && element.querySelector('[data-ad-rendering-role="comment_button"]')
                            && element.querySelector('[data-ad-rendering-role="share_button"]')
                        ) {
                            return element;
                        }

                        element = element.parentElement;
                    }

                    return null;
                };
                const dialog = document.querySelector(dialogSelector);
                const storyMessage = Array.from(
                    document.querySelectorAll(storySelector)
                ).find(visible);
                const postRoot = dialog ?? getPostRoot(storyMessage);
                const selector = dialog
                    ? modalCommentSelector
                    : embeddedCommentSelector;
                const comments = postRoot
                    ? Array.from(postRoot.querySelectorAll(selector))
                    : [];
                const uniqueComments = Array.from(new Set(comments))
                    .filter(visible);

                const getIds = (article, isReply) => {
                    const values = [];
                    let commentId = null;
                    let parentId = null;
                    let replyId = null;
                    const add = (value) => {
                        const normalized = normalize(value);
                        if (normalized && !values.includes(normalized)) {
                            values.push(normalized);
                        }
                    };

                    for (const link of article.querySelectorAll('a[href]')) {
                        try {
                            const url = new URL(link.href, location.href);
                            const replyValue = url.searchParams.get("reply_comment_id");
                            const commentValue = url.searchParams.get("comment_id");
                            if (isReply && replyValue) replyId = normalize(replyValue);
                            if (isReply && commentValue) parentId = normalize(commentValue);
                            if (!isReply && commentValue) commentId = normalize(commentValue);
                            add(replyValue);
                            add(commentValue);
                        } catch {}
                    }

                    for (const element of [article, ...article.querySelectorAll("*")]) {
                        for (const attribute of ["data-ft", "data-id", "data-comment-id", "id"]) {
                            const value = element.getAttribute(attribute);
                            if (!value) continue;

                            try {
                                const parsed = JSON.parse(value);
                                add(parsed.comment_id);
                                add(parsed.reply_comment_id);
                            } catch {
                                if (attribute !== "data-ft") add(value);
                            }
                        }
                    }

                    return { values, commentId, parentId, replyId };
                };

                return uniqueComments.map((article) => {
                    const isReply = article.matches('[aria-label^="Reply by "]');
                    const ids = getIds(article, isReply);
                    const fallbackId = ids.values[0] ?? null;
                    const commentId = isReply
                        ? ids.replyId ?? ids.values.find((value) => value !== ids.parentId) ?? null
                        : ids.commentId ?? fallbackId;

                    return {
                        id: commentId,
                        parentId: isReply ? ids.parentId : null,
                        isReply,
                        authorLabel: normalize(article.getAttribute("aria-label")),
                        text: normalize(article.innerText).slice(0, 160),
                    };
                });
            },
            {
                dialogSelector: postDialogSelector,
                storySelector: storyMessageSelector,
                embeddedCommentSelector: allEmbeddedPostCommentSelector,
                modalCommentSelector: allPostCommentSelector,
            }
        );

        console.log("=== Знайдені коментарі поточного поста ===");
        if (result.length === 0) {
            console.log("Видимих коментарів або відповідей у корені поста не знайдено");
        } else {
            result.forEach((comment, index) => {
                console.log(formatCommentLog(comment, index));
                if (!comment.id) {
                    console.log(`   label: ${comment.authorLabel || "—"}`);
                    console.log(`   text: ${comment.text || "—"}`);
                }
            });
        }

        const target = targetCommentId
            ? result.find((comment) => comment.id === String(targetCommentId))
            : result[0];

        if (targetCommentId) {
            console.log(target
                ? `Цільовий коментар знайдено: ${targetCommentId}`
                : `Цільовий коментар не знайдено серед побачених: ${targetCommentId}`);
        } else if (target) {
            console.log(
                `Коментар без ID вибрано як перший у черзі: ${target.id ?? "ID не знайдено"}`
            );
        }

        console.log(`Усього знайдено: ${result.length}`);
        return result;
    } catch (error) {
        console.error("Не вдалося знайти та обвести коментарі поста:", error.message);
        return [];
    }
}
