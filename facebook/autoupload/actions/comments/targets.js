import { actionError } from '../../graphql/errors.js';
import resolveCommentTarget from '../../../../services/autoupload/resolveCommentTarget.js';

// Обхід обмежений, щоб некоректна відповідь не блокувала процес.
export function objects(roots) {
    const result = [];
    const stack = [...roots];
    while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== 'object') continue;
        if (result.length >= 150000) throw actionError('Завелика відповідь Facebook', 'FACEBOOK_RESPONSE_TOO_LARGE');
        result.push(value);
        for (const child of Object.values(value)) if (child && typeof child === 'object') stack.push(child);
    }
    return result;
}

export function htmlObjects(html) {
    const roots = [];
    for (const script of String(html ?? '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!/\btype\s*=\s*["']application\/json["']/i.test(script[1])) continue;
        try { roots.push(JSON.parse(script[2])); } catch {}
    }
    return objects(roots);
}

export function validateFeedbackId(id) {
    if (typeof id !== 'string' || !/^feedback:.+/.test(Buffer.from(id, 'base64').toString('utf8'))) {
        throw actionError('Не отримано feedback ID цілі', 'FACEBOOK_FEEDBACK_TARGET_INVALID');
    }
    return id;
}

export function matchStory(story, input) {
    if (story?.__typename !== 'Story') return false;
    for (const value of [story.permalink_url, story.url]) {
        if (!value) continue;
        try { if (resolveCommentTarget(value).storyId === input.storyId) return true; } catch {}
    }
    return String(story.post_id ?? '') === input.storyId;
}

export function reactionFeedback(nodes, feedbackId) {
    return nodes.find(node => node.id === feedbackId && Object.hasOwn(node, 'viewer_feedback_reaction_info'));
}

export function commentTarget(node, postTarget) {
    return {
        commentId: String(node.id), legacyCommentId: node.legacy_fbid == null ? null : String(node.legacy_fbid),
        commentFeedbackId: node.feedback?.id ?? null, postFeedbackId: postTarget.postFeedbackId,
        postUrl: postTarget.postUrl, commentUrl: node.url ?? node.feedback?.url ?? null,
        parentCommentId: node.comment_direct_parent?.id ?? null,
        threadFeedbackId: node.feedback?.parent_object_ent?.feedback?.id ?? node.feedback?.id ?? null,
    };
}

export async function readPost(fbData, postUrl, { signal, commentId } = {}) {
    fbData.client.validateFbData(fbData, { allowPageActor: true });
    const input = resolveCommentTarget(postUrl);
    const url = new URL(input.postUrl);
    if (commentId) url.searchParams.set('comment_id', commentId);
    const response = await fbData.client.requestSessionPage({ url: url.href, signal, historyPurpose: 'runtime' });
    const nodes = htmlObjects(response.data);
    const story = nodes.find(node => matchStory(node, input));
    if (!story) throw actionError('Пост недоступний для цього профілю або Facebook не повернув його об’єкт', 'FACEBOOK_POST_NOT_AVAILABLE', { httpStatus: response.status });
    const scoped = objects([story]);
    const feedback = scoped.find(node => node.id === input.feedbackId);
    if (!feedback) throw actionError('Не підтверджено feedback потрібного поста', 'FACEBOOK_POST_NOT_CONFIRMED');
    return { nodes: scoped, postTarget: { postId: String(story.post_id ?? input.storyId), storyId: input.storyId, postFeedbackId: feedback.id, postUrl: input.postUrl }, httpStatus: response.status };
}
