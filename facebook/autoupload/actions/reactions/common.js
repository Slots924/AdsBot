import { actionError } from '../../graphql/errors.js';

export const reactionIds = Object.freeze({ like: '1635855486666999', love: '1678524932434102', care: '613557422527858', haha: '115940658764963', wow: '478547315650144', sad: '908563459236466', angry: '444813342392137' });

export function readReaction(feedback) {
    if (!feedback || !Object.hasOwn(feedback, 'viewer_feedback_reaction_info')) throw actionError('Facebook не повернув стан власної реакції', 'FACEBOOK_REACTION_NOT_LOADED');
    const info = feedback.viewer_feedback_reaction_info;
    if (info === null) return null;
    const name = Object.keys(reactionIds).find(key => reactionIds[key] === info?.id);
    if (!name) throw actionError('Facebook повернув невідому реакцію', 'FACEBOOK_REACTION_INVALID');
    return { name, id: info.id };
}

export const readResult = (target, reaction, httpStatus) => ({ success: true, outcome: 'LOADED', code: null, message: 'Стан власної реакції отримано', ...target, reaction, httpStatus, mutationAttempted: false, outcomeUnknown: false, retryable: false });
