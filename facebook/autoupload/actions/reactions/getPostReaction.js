import { tracedAction } from '../../../../services/reports/HttpExchangeTrace.js';
import getPostContext from '../posts/getPostContext.js';

async function execute(fbData, { postTarget } = {}, options = {}) {
    const result = await getPostContext(fbData, { postUrl: postTarget?.postUrl }, options);
    if (result.success && result.postFeedbackId !== postTarget?.postFeedbackId) return { ...result, success: false, outcome: 'NOT_CONFIRMED', code: 'FACEBOOK_POST_TARGET_INVALID', message: 'Отримано інший пост' };
    if (!result.success || result.reactionKnown) return result;
    return { ...result, success: false, outcome: 'NOT_CONFIRMED', code: result.reactionError.code, message: result.reactionError.message };
}
export default tracedAction('getPostReaction', execute, data => ({ profileId: data?.profileId }));
