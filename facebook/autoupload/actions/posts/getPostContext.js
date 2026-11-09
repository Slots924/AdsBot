import { tracedAction } from '../../../../services/reports/HttpExchangeTrace.js';
import { actionFailure } from '../../graphql/errors.js';
import { readPost, reactionFeedback } from '../comments/targets.js';
import { readReaction, readResult } from '../reactions/common.js';

async function execute(fbData, { postUrl } = {}, options = {}) {
    try {
        return await fbData.client.run(async () => {
            const { nodes, postTarget, httpStatus } = await readPost(fbData, postUrl, options);
            let reaction = null;
            let reactionError = null;
            try { reaction = readReaction(reactionFeedback(nodes, postTarget.postFeedbackId)); }
            catch (error) { reactionError = { code: error.code, message: error.message }; }
            return { ...readResult({ postTarget, ...postTarget }, reaction, httpStatus), available: true, reactionKnown: !reactionError, reactionError };
        });
    } catch (error) { return { ...actionFailure(error), available: false, mutationAttempted: false }; }
}
export default tracedAction('getPostContext', execute, data => ({ profileId: data?.profileId }));
