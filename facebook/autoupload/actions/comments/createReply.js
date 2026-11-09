import { tracedAction } from '../../../../services/reports/HttpExchangeTrace.js';
import { actionError, actionFailure } from '../../graphql/errors.js';
import { executeCreateComment } from './createComment.js';
import { validateFeedbackId } from './targets.js';

async function execute(fbData, { parentCommentTarget, text } = {}, options = {}) {
    try {
        if (!parentCommentTarget?.commentId || !parentCommentTarget.postFeedbackId || !parentCommentTarget.postUrl) throw actionError('Не передано підтвердженого батьківського коментаря', 'FACEBOOK_REPLY_TARGET_INVALID');
        if (!/^comment:.+/.test(Buffer.from(parentCommentTarget.commentId, 'base64').toString('utf8'))) throw actionError('Не передано GraphQL ID батьківського коментаря', 'FACEBOOK_REPLY_TARGET_INVALID');
        validateFeedbackId(parentCommentTarget.postFeedbackId);
        validateFeedbackId(parentCommentTarget.commentFeedbackId);
        const feedbackId = validateFeedbackId(parentCommentTarget.threadFeedbackId ?? parentCommentTarget.commentFeedbackId);
        return await executeCreateComment(fbData, { feedbackId, text, parentCommentTarget }, options);
    } catch (error) { return { ...actionFailure(error), mutationAttempted: false }; }
}
export default tracedAction('createReply', execute, data => ({ profileId: data?.profileId }));
