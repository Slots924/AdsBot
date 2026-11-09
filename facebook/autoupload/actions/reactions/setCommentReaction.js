import { tracedAction } from '../../../../services/reports/HttpExchangeTrace.js';
import setReaction from './setReaction.js';
export default tracedAction('setCommentReaction', (data, input, options) => setReaction('comment', data, input, options), data => ({ profileId: data?.profileId }));
