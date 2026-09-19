import { waitForDomQuiet } from "../browser/confirmedClick.js";
import {
    clickLeftMouse,
    moveMouseToElement,
} from "../browser/pointer.js";
import { waitForVisibleElement } from "../browser/elements.js";
import { humanScrollToElement } from "../browser/scroll.js";
import { waitHuman, waitRandom } from "../browser/timing.js";
import {
    getReactionOptionSelector,
    reactionsToolbarSelector,
} from "../selectors/reactions.js";
import {
    allEmbeddedPostCommentSelector,
    allPostCommentSelector,
    postDialogSelector,
    storyMessageSelector,
} from "../selectors/post.js";


const reactionNames = Object.freeze({
    like: "Like",
    love: "Love",
    care: "Care",
    haha: "Haha",
    wow: "Wow",
    sad: "Sad",
    angry: "Angry",
});

export const commentReactionStatuses = Object.freeze({
    APPLIED: "APPLIED",
    ALREADY_REACTED: "ALREADY_REACTED",
    FAILED: "FAILED",
});

export const commentReactionFailureReasons = Object.freeze({
    COMMENT_NOT_FOUND: "COMMENT_NOT_FOUND",
    REACTION_BUTTON_NOT_FOUND: "REACTION_BUTTON_NOT_FOUND",
    REACTION_OPTION_NOT_FOUND: "REACTION_OPTION_NOT_FOUND",
    VERIFICATION_FAILED: "VERIFICATION_FAILED",
    INVALID_REACTION: "INVALID_REACTION",
    ERROR: "ERROR",
});

const reactionToolbarTimeout = 15000;
const verificationTimeout = 3000;
const domQuietTimeout = 5000;
const domQuietMs = 300;
const postCommentDomSelector =
    `${allPostCommentSelector}, ${allEmbeddedPostCommentSelector}`;


function failed(reason, details = {}) {
    return {
        status: commentReactionStatuses.FAILED,
        reason,
        ...details,
    };
}


function findCommentInPost(
    dialogSelector,
    storySelector,
    embeddedCommentSelector,
    modalCommentSelector,
    targetCommentId
) {
    const commentArticleSelector =
        '[role="article"][aria-label^="Comment by " i], '
        + '[role="article"][aria-label^="Reply by " i]';
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
    const isVisible = (element) => {
        const rectangle = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return rectangle.width > 0
            && rectangle.height > 0
            && style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0";
    };
    const dialog = document.querySelector(dialogSelector);
    const storyMessage = Array.from(
        document.querySelectorAll(storySelector)
    ).find(isVisible);
    const postRoot = dialog ?? getPostRoot(storyMessage);
    const selector = dialog
        ? modalCommentSelector
        : embeddedCommentSelector;
    const comments = postRoot
        ? Array.from(postRoot.querySelectorAll(selector)).filter(isVisible)
        : [];

    if (!targetCommentId) {
        return comments[0] ?? null;
    }

    return comments.find((article) => Array.from(
        article.querySelectorAll('a[href*="comment_id="]')
    ).filter((link) => link.closest(commentArticleSelector) === article)
        .some((link) => {
        try {
            const url = new URL(link.href, location.href);

            return url.searchParams.get("comment_id") === targetCommentId
                || url.searchParams.get("reply_comment_id") === targetCommentId;
        } catch {
            return false;
        }
        })) ?? null;
}


function getCommentId(article) {
    const commentArticleSelector =
        '[role="article"][aria-label^="Comment by " i], '
        + '[role="article"][aria-label^="Reply by " i]';
    const isReply = article.matches('[aria-label^="Reply by " i]');

    for (const link of Array.from(
        article.querySelectorAll('a[href*="comment_id="]')
    ).filter((item) => item.closest(commentArticleSelector) === article)) {
        try {
            const url = new URL(link.href, location.href);
            const id = isReply
                ? url.searchParams.get("reply_comment_id")
                : url.searchParams.get("comment_id");

            if (id) return id;
        } catch {}
    }

    return null;
}


async function getComment(page, targetCommentId) {
    const handle = await page.evaluateHandle(
        findCommentInPost,
        postDialogSelector,
        storyMessageSelector,
        allEmbeddedPostCommentSelector,
        allPostCommentSelector,
        targetCommentId ? String(targetCommentId) : null
    );
    const comment = handle.asElement();

    if (!comment) {
        await handle.dispose();
        return null;
    }

    return comment;
}


async function getCommentReactionButton(comment) {
    const handle = await comment.evaluateHandle((article) => {
        const isVisible = (element) => {
            const rectangle = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);

            return rectangle.width > 0
                && rectangle.height > 0
                && style.display !== "none"
                && style.visibility !== "hidden"
                && style.opacity !== "0";
        };

        return Array.from(article.querySelectorAll('[role="button"][aria-label]'))
            .find((button) => {
                const owner = button.closest(
                    '[role="article"][aria-label^="Comment by " i], '
                    + '[role="article"][aria-label^="Reply by " i]'
                );
                const label = button.getAttribute("aria-label") ?? "";

                return owner === article
                    && isVisible(button)
                    && (label.toLowerCase() === "like"
                        || label.toLowerCase().startsWith("remove "));
            }) ?? null;
    });
    const button = handle.asElement();

    if (!button) {
        await handle.dispose();
        return null;
    }

    return button;
}


async function getCurrentReaction(button) {
    return button.evaluate((target) => {
        const label = target.getAttribute("aria-label") ?? "";
        const match = /^remove\s+(.+)$/i.exec(label.trim());

        return match?.[1] ?? null;
    });
}


async function hoverElement(page, element) {
    await moveMouseToElement(page, element, {
        scrollIntoView: false,
        steps: [14, 28],
    });
    await waitRandom(60, 180);
}


async function clickElement(page, element) {
    await hoverElement(page, element);
    await clickLeftMouse(page, { holdDelay: [70, 170] });
}


async function waitForAppliedReaction(page, targetCommentId, reactionName) {
    try {
        const readyHandle = await page.waitForFunction(
            (
                dialogSelector,
                storySelector,
                embeddedCommentSelector,
                modalCommentSelector,
                commentId,
                expectedReaction
            ) => {
                const isVisible = (element) => {
                    const rectangle = element.getBoundingClientRect();
                    const style = window.getComputedStyle(element);

                    return rectangle.width > 0
                        && rectangle.height > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden"
                        && style.opacity !== "0";
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
                ).find(isVisible);
                const postRoot = dialog ?? getPostRoot(storyMessage);
                const selector = dialog
                    ? modalCommentSelector
                    : embeddedCommentSelector;
                const comment = Array.from(
                    postRoot?.querySelectorAll(selector) ?? []
                ).find((article) => {
                    if (!isVisible(article)) return false;

                    if (!commentId) return true;

                    return Array.from(
                        article.querySelectorAll('a[href*="comment_id="]')
                    ).filter((link) => link.closest(
                        '[role="article"][aria-label^="Comment by " i], '
                        + '[role="article"][aria-label^="Reply by " i]'
                    ) === article).some((link) => {
                        try {
                            const url = new URL(link.href, location.href);

                            return url.searchParams.get("comment_id") === commentId
                                || url.searchParams.get("reply_comment_id") === commentId;
                        } catch {
                            return false;
                        }
                    });
                });

                if (!comment) return false;

                const button = Array.from(
                    comment.querySelectorAll('[role="button"][aria-label]')
                ).find((candidate) => {
                    const owner = candidate.closest(
                        '[role="article"][aria-label^="Comment by " i], '
                        + '[role="article"][aria-label^="Reply by " i]'
                    );

                    return owner === comment;
                });

                return button?.getAttribute("aria-label")
                    === `Remove ${expectedReaction}`;
            },
            { timeout: verificationTimeout },
            postDialogSelector,
            storyMessageSelector,
            allEmbeddedPostCommentSelector,
            allPostCommentSelector,
            targetCommentId,
            reactionName
        );
        await readyHandle.dispose();
        return true;
    } catch {
        return false;
    }
}


export default async function setCommentReaction(
    page,
    { commentId = null, reaction = "like" } = {}
) {
    const selectedReaction = String(reaction).trim().toLowerCase();
    const reactionName = reactionNames[selectedReaction];

    if (!reactionName) {
        return failed(commentReactionFailureReasons.INVALID_REACTION, {
            reaction,
        });
    }

    let comment;
    let reactionButton;

    try {
        comment = await getComment(page, commentId);
        if (!comment) {
            return failed(commentReactionFailureReasons.COMMENT_NOT_FOUND, {
                commentId,
            });
        }

        await humanScrollToElement(page, comment, {
            position: "center",
            jitterPx: 40,
            durationMs: 800,
            stepRange: [10, 25],
        });
        await comment.dispose();
        comment = null;

        await waitForDomQuiet(
            page,
            { selector: postCommentDomSelector },
            { quietMs: domQuietMs, timeout: domQuietTimeout }
        ).catch(() => {});

        comment = await getComment(page, commentId);
        if (!comment) {
            return failed(commentReactionFailureReasons.COMMENT_NOT_FOUND, {
                commentId,
            });
        }

        const resolvedCommentId = await comment.evaluate(getCommentId);
        reactionButton = await getCommentReactionButton(comment);
        if (!reactionButton) {
            return failed(commentReactionFailureReasons.REACTION_BUTTON_NOT_FOUND, {
                commentId: resolvedCommentId ?? commentId,
            });
        }

        const currentReaction = await getCurrentReaction(reactionButton);
        if (currentReaction) {
            return {
                status: commentReactionStatuses.ALREADY_REACTED,
                commentId: resolvedCommentId ?? commentId,
                currentReaction,
            };
        }

        if (selectedReaction === "like") {
            await clickElement(page, reactionButton);
        } else {
            await hoverElement(page, reactionButton);
            await reactionButton.dispose();
            reactionButton = null;
            await waitHuman("medium");

            const toolbar = await waitForVisibleElement(
                page,
                reactionsToolbarSelector,
                { timeout: reactionToolbarTimeout }
            ).catch(() => null);
            if (!toolbar) {
                return failed(commentReactionFailureReasons.REACTION_OPTION_NOT_FOUND, {
                    commentId: resolvedCommentId ?? commentId,
                    reaction: reactionName,
                });
            }
            await toolbar.dispose();

            const reactionOptionSelector = getReactionOptionSelector(reactionName);
            const initialReactionOption = await waitForVisibleElement(
                page,
                reactionOptionSelector,
                { timeout: reactionToolbarTimeout }
            ).catch(() => null);
            if (!initialReactionOption) {
                return failed(commentReactionFailureReasons.REACTION_OPTION_NOT_FOUND, {
                    commentId: resolvedCommentId ?? commentId,
                    reaction: reactionName,
                });
            }
            await initialReactionOption.dispose();

            await waitForDomQuiet(
                page,
                { selector: reactionOptionSelector },
                { quietMs: domQuietMs, timeout: domQuietTimeout }
            ).catch(() => {});

            const reactionOption = await waitForVisibleElement(
                page,
                reactionOptionSelector,
                { timeout: reactionToolbarTimeout }
            ).catch(() => null);
            if (!reactionOption) {
                return failed(commentReactionFailureReasons.REACTION_OPTION_NOT_FOUND, {
                    commentId: resolvedCommentId ?? commentId,
                    reaction: reactionName,
                });
            }

            try {
                await clickElement(page, reactionOption);
            } finally {
                await reactionOption.dispose().catch(() => {});
            }
        }

        const verificationCommentId = resolvedCommentId ?? commentId;
        if (!await waitForAppliedReaction(
            page,
            verificationCommentId,
            reactionName
        )) {
            return failed(commentReactionFailureReasons.VERIFICATION_FAILED, {
                commentId: verificationCommentId,
                reaction: reactionName,
            });
        }

        return {
            status: commentReactionStatuses.APPLIED,
            commentId: verificationCommentId,
            reaction: reactionName,
        };
    } catch (error) {
        return failed(commentReactionFailureReasons.ERROR, {
            commentId,
            reaction: reactionName,
            error: error.message,
        });
    } finally {
        await reactionButton?.dispose().catch(() => {});
        await comment?.dispose().catch(() => {});
    }
}
