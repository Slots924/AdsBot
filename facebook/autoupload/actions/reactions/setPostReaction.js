import { tracedAction } from '../../../../services/reports/HttpExchangeTrace.js';
import setReaction from './setReaction.js';
export default tracedAction('setPostReaction', (data, input, options) => setReaction('post', data, input, options), data => ({ profileId: data?.profileId }));
