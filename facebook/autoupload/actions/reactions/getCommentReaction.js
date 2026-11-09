import { tracedAction } from '../../../../services/reports/HttpExchangeTrace.js';
import { actionError, actionFailure } from '../../graphql/errors.js';
import { readPost, reactionFeedback } from '../comments/targets.js';
import { readReaction, readResult } from './common.js';

async function execute(fbData, { commentTarget } = {}, options = {}) {
    try {
        return await fbData.client.run(async () => {
            if (!commentTarget?.commentId || !commentTarget.legacyCommentId || !commentTarget.commentFeedbackId) throw actionError('Не передано ціль коментаря', 'FACEBOOK_COMMENT_TARGET_INVALID');
            const { nodes, postTarget, httpStatus } = await readPost(fbData, commentTarget.postUrl, { ...options, commentId: commentTarget.legacyCommentId });
            if (postTarget.postFeedbackId !== commentTarget.postFeedbackId) throw actionError('Коментар належить іншому посту', 'FACEBOOK_COMMENT_TARGET_INVALID');
            const node = nodes.find(node => node.id === commentTarget.commentId && String(node.legacy_fbid) === commentTarget.legacyCommentId && node.feedback?.id === commentTarget.commentFeedbackId);
            if (!node) throw actionError('Потрібний коментар не отримано', 'FACEBOOK_COMMENT_NOT_LOADED');
            return readResult({ commentTarget }, readReaction(reactionFeedback(nodes, commentTarget.commentFeedbackId)), httpStatus);
        });
    } catch (error) { return { ...actionFailure(error), mutationAttempted: false }; }
}
export default tracedAction('getCommentReaction', execute, data => ({ profileId: data?.profileId }));
