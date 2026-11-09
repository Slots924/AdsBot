import { randomUUID } from "node:crypto";
import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import requestGraphql from "../../graphql/request.js";
import { actionError, actionFailure } from "../../graphql/errors.js";

export const createCommentMutation = Object.freeze({
    friendlyName: "useCometUFICreateCommentMutation",
    // Ідентифікатор підтверджено під час публікації коментаря у браузері.
    docId: "28865832786377560",
});

export async function executeCreateComment(fbData, { feedbackId, text, parentCommentTarget = null, postTarget = null } = {}, { signal, beforeSend } = {}) {
    let sent = false;
    try {
        if (typeof feedbackId !== "string" || !/^feedback:.+/.test(Buffer.from(feedbackId, "base64").toString("utf8"))) {
            throw actionError("Не передано коректний feedbackId", "FACEBOOK_COMMENT_TARGET_INVALID");
        }
        if (typeof text !== "string" || !text.trim()) throw actionError("Коментар не може бути порожнім", "FACEBOOK_COMMENT_TEXT_INVALID");
        if (typeof fbData?.client?.run !== "function") throw actionError("Не передано готову HTTP-сесію", "FACEBOOK_SESSION_REQUIRED");
        return await fbData.client.run(async () => {
            const variables = {
                feedLocation: parentCommentTarget ? "POST_PERMALINK_DIALOG" : "PERMALINK", feedbackSource: 2, groupID: null,
                input: {
                    client_mutation_id: randomUUID(), attachments: null, feedback_id: feedbackId,
                    formatting_style: null, is_inline_vote_enabled_for_qna: false,
                    message: { ranges: [], text }, vod_video_timestamp: null,
                    ...(parentCommentTarget ? { reply_comment_parent_fbid: parentCommentTarget.commentId, reply_target_clicked: true } : {}),
                    is_tracking_encrypted: true, tracking: [], feedback_source: "OBJECT",
                    idempotence_token: randomUUID(), session_id: randomUUID(),
                },
                inviteShortLinkKey: null, renderLocation: null, scale: 1, useDefaultActor: false,
                focusCommentID: null, translationType: "ORIGINAL", canUseNicknameOnComet: false,
                __relay_internal__pv__groups_comet_use_glvrelayprovider: false,
                __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
                __relay_internal__pv__IsWorkUserrelayprovider: false,
                __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
                __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider: "ORIGINAL",
            };
            const result = await requestGraphql(fbData, createCommentMutation, variables, {
                signal, allowPageActor: true, beforeSend: async () => { await beforeSend?.(); signal?.throwIfAborted(); sent = true; },
            });
            const created = result.chunks.map(chunk => chunk.data?.comment_create).find(value => value?.feedback_comment_edge?.node?.id);
            const node = created?.feedback_comment_edge?.node;
            if (!node?.id || created.feedback?.id !== feedbackId) {
                throw actionError("Facebook не повернув ID коментаря для потрібної цілі", "FACEBOOK_COMMENT_NOT_CONFIRMED", { outcomeUnknown: true, httpStatus: result.httpStatus });
            }
            if (parentCommentTarget && (created.feedback?.id !== feedbackId
                || node.comment_direct_parent?.id !== parentCommentTarget.commentId)) {
                throw actionError("Facebook не підтвердив батьківський коментар відповіді", "FACEBOOK_REPLY_NOT_CONFIRMED", { outcomeUnknown: true, httpStatus: result.httpStatus });
            }
            const target = {
                commentId: String(node.id), legacyCommentId: node.legacy_fbid == null ? null : String(node.legacy_fbid),
                commentFeedbackId: node.feedback?.id ?? null,
                postFeedbackId: parentCommentTarget?.postFeedbackId ?? feedbackId,
                postUrl: parentCommentTarget?.postUrl ?? postTarget?.postUrl ?? null,
                commentUrl: node.url ?? node.feedback?.url ?? null,
                parentCommentId: parentCommentTarget?.commentId ?? null,
                threadFeedbackId: parentCommentTarget?.threadFeedbackId ?? parentCommentTarget?.commentFeedbackId ?? node.feedback?.id ?? null,
            };
            return {
                success: true, outcome: "CREATED", code: null, message: "Коментар створено, ID отримано",
                ...target, commentTarget: target,
                text: node.body?.text ?? node.preferred_body?.text ?? text, createdTime: node.created_time ?? null,
                httpStatus: result.httpStatus, traceId: result.traceId, metaRequestId: result.metaRequestId,
                mutationAttempted: true, outcomeUnknown: false, retryable: false,
            };
        });
    } catch (error) {
        if (sent && error.code !== "FACEBOOK_GRAPHQL_ERROR") error.outcomeUnknown = true;
        // Черга пропускає невизначений коментар; підказки дружніх екшенів тут не застосовуються.
        if (error.outcomeUnknown) error.actionRequired = null;
        return { ...actionFailure(error), mutationAttempted: sent };
    }
}

export default tracedAction("createComment", executeCreateComment, value => ({ profileId: value?.profileId }));
