import { randomUUID } from 'node:crypto';
import requestGraphql from '../../graphql/request.js';
import { actionError, actionFailure } from '../../graphql/errors.js';
import { objects, reactionFeedback, validateFeedbackId } from '../comments/targets.js';
import { reactionIds, readReaction } from './common.js';
import getPostReaction from './getPostReaction.js';
import getCommentReaction from './getCommentReaction.js';

export const reactMutation = Object.freeze({ friendlyName: 'CometUFIFeedbackReactMutation', docId: '27646120298312844' });

export default async function setReaction(kind, fbData, input = {}, options = {}) {
    let sent = false;
    const target = kind === 'post' ? input.postTarget : input.commentTarget;
    const reader = kind === 'post' ? getPostReaction : getCommentReaction;
    const targetInput = kind === 'post' ? { postTarget: target } : { commentTarget: target };
    try {
        if (input.reaction !== null && !Object.hasOwn(reactionIds, input.reaction)) throw actionError('Невідома реакція', 'FACEBOOK_REACTION_INVALID');
        const feedbackId = validateFeedbackId(kind === 'post' ? target?.postFeedbackId : target?.commentFeedbackId);
        const current = await reader(fbData, targetInput, options);
        if (!current.success) return { ...current, mutationAttempted: false };
        const requestedId = input.reaction === null ? null : reactionIds[input.reaction];
        if ((current.reaction?.id ?? null) === requestedId) return { ...current, outcome: 'UNCHANGED', message: 'Потрібний стан реакції вже встановлено', mutationAttempted: false };
        const result = await fbData.client.run(() => requestGraphql(fbData, reactMutation, {
            input: { feedback_id: feedbackId, feedback_reaction_id: requestedId ?? '0', feedback_source: 'OBJECT', is_tracking_encrypted: true,
                tracking: [], session_id: randomUUID(), actor_id: String(fbData.session.FacebookID), client_mutation_id: randomUUID() },
            scale: 1, canUseNicknameOnComet: false, useDefaultActor: false,
            __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
        }, { signal: options.signal, allowPageActor: true, beforeSend: async () => { await options.beforeSend?.(); options.signal?.throwIfAborted(); sent = true; } }));
        const feedback = reactionFeedback(objects(result.chunks), feedbackId);
        let confirmed;
        if (feedback) confirmed = { success: true, reaction: readReaction(feedback) };
        else confirmed = await reader(fbData, targetInput, { signal: options.signal });
        if (!confirmed.success || (confirmed.reaction?.id ?? null) !== requestedId) throw actionError('Стан реакції не підтверджено', 'FACEBOOK_REACTION_NOT_CONFIRMED', { outcomeUnknown: true, httpStatus: result.httpStatus, sessionStatus: confirmed.sessionStatus });
        return { success: true, outcome: requestedId === null ? 'REMOVED' : 'APPLIED', code: null, message: requestedId === null ? 'Реакцію прибрано' : 'Реакцію встановлено',
            ...targetInput, reaction: confirmed.reaction, httpStatus: result.httpStatus, mutationAttempted: true, outcomeUnknown: false, retryable: false };
    } catch (error) {
        if (sent && error.code !== 'FACEBOOK_GRAPHQL_ERROR') error.outcomeUnknown = true;
        if (error.outcomeUnknown) error.actionRequired = null;
        return { ...actionFailure(error), mutationAttempted: sent };
    }
}
