import { randomUUID } from 'node:crypto';
import { actionFailure } from '../../facebook/autoupload/graphql/errors.js';
import { isSessionUnavailable } from '../../facebook/session/sessionStatus.js';

export function prepareDialogue(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw new Error('Креатив має містити від 1 до 1000 рядків');
    const normalized = rows.map((row, index) => ({ ...row, id: String(row.id ?? index + 1), parent_id: row.parent_id == null ? null : String(row.parent_id), profile_key: row.profile_key || null }));
    const byId = new Map(normalized.map(row => [row.id, row]));
    if (byId.size !== normalized.length || normalized.some(row => !row.id)) throw new Error('ID коментарів мають бути унікальними');
    const genders = new Map();
    for (const row of normalized.filter(row => !row.is_author && row.should_write !== false)) {
        if (!['male', 'female'].includes(row.gender)) throw new Error('У коментаря не вказана стать');
        if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 8000) throw new Error('Коментар має містити від 1 до 8000 символів');
        if (row.profile_key && genders.has(row.profile_key) && genders.get(row.profile_key) !== row.gender) throw new Error('Стать одного учасника діалогу має збігатися');
        if (row.profile_key) genders.set(row.profile_key, row.gender);
    }
    const ordered = [];
    const states = new Map();
    const visit = row => {
        if (states.get(row.id) === 'done') return;
        if (states.get(row.id) === 'visiting') throw new Error('Циклічні залежності коментарів');
        states.set(row.id, 'visiting');
        if (byId.has(row.parent_id)) visit(byId.get(row.parent_id));
        states.set(row.id, 'done');
        ordered.push(row);
    };
    normalized.forEach(visit);
    return ordered;
}

// Один виконавець керує залежностями, учасниками та обмеженнями спроб.
export default async function runCommentDialogue({ rows, profiles, postUrl, prepare, getPostContext, setPostReaction, createComment, createReply,
    persist, persistState, afterSuccess = async () => {}, saveSession = async () => {}, handleRestriction = async () => {},
    progress = async () => {}, signal, random = Math.random }) {
    const startedAt = Date.now();
    const queue = prepareDialogue(rows).map(row => ({ ...row, type: row.parent_id === null ? 'comment' : 'reply', status: 'pending', attempts: [] }));
    const byId = new Map(queue.map(row => [row.id, row]));
    const assignments = Object.create(null);
    const consumed = new Set();
    const broken = new Set();
    const sessions = new Map();
    const reactions = [];
    const attempts = [];
    let stoppedForStorage = false;
    const state = () => ({ rows: queue, assignments: { ...assignments }, reactions, postUrl });
    const saveState = async () => {
        try { await persistState(state()); return true; }
        catch { stoppedForStorage = true; return false; }
    };
    await saveState();
    for (const row of queue) {
        if (signal?.aborted || stoppedForStorage) break;
        const parent = byId.get(row.parent_id);
        if (row.is_author || row.should_write === false || (row.parent_id !== null && parent?.status !== 'success')) {
            row.status = 'skipped';
            row.message = row.is_author ? 'Рядок автора' : row.should_write === false ? 'should_write=false' : 'Батьківський коментар не підтверджено';
            await saveState();
            continue;
        }
        const pinned = row.profile_key ? assignments[row.profile_key] : null;
        if (pinned && broken.has(pinned)) {
            row.status = 'skipped'; row.message = 'Закріплений профіль недоступний'; await saveState(); continue;
        }
        while (!signal?.aborted && !stoppedForStorage) {
            const profile = pinned ? profiles.find(p => p.profileId === pinned) : profiles.find(p => !consumed.has(p.profileId) && p.gender === row.gender);
            if (!profile) { row.status = row.attempts.length ? 'failed' : 'skipped'; row.message = row.attempts.length ? `${row.message}. Закінчилися профілі потрібної статі` : 'Немає доступного профілю потрібної статі'; break; }
            const id = profile.profileId;
            consumed.add(id);
            row.profileId = id; row.profileNo = profile.profileNo;
            const attemptId = randomUUID();
            let action;
            let publicationInvoked = false;
            let session = sessions.get(id);
            await progress({ stage: row.type, completed: queue.filter(r => r.status !== 'pending').length, total: queue.length, message: `№${profile.profileNo} · ${row.type === 'reply' ? 'реплай' : 'коментар'} ${row.id}` });
            // Намір зберігається до мережевих змін; незавершена спроба не повторюється автоматично.
            row.attempts.push({ attemptId, profileId: id, profileNo: profile.profileNo, status: 'started' });
            if (!await saveState()) break;
            try {
                if (!session) {
                    const prepared = await prepare(profile);
                    if (!prepared.client) action = { ...prepared.result, success: false, sessionStatus: prepared.result.sessionStatus ?? prepared.result.status, mutationAttempted: false, outcomeUnknown: false };
                    else {
                        const fbData = prepared.client.getFbData(id);
                        const context = await getPostContext(fbData, { postUrl }, { signal });
                        await handleRestriction(id, context);
                        if (!context.success) action = context;
                        else {
                            session = { client: prepared.client, fbData, postTarget: context.postTarget };
                            sessions.set(id, session);
                            let reaction;
                            if (!context.reactionKnown) reaction = { success: false, outcome: 'NOT_CONFIRMED', message: context.reactionError?.message ?? 'Стан реакції невідомий' };
                            else if (context.reaction) reaction = { success: true, outcome: 'UNCHANGED', reaction: context.reaction, mutationAttempted: false };
                            else {
                                const name = ['like', 'love', 'wow'][Math.min(2, Math.floor(random() * 3))];
                                try { reaction = await setPostReaction(fbData, { postTarget: context.postTarget, reaction: name }, { signal }); }
                                catch (error) { reaction = actionFailure(error); }
                                await handleRestriction(id, reaction);
                            }
                            reactions.push({ profileId: id, profileNo: profile.profileNo, ...reaction });
                            if (!await saveState()) break;
                            if (isSessionUnavailable(reaction.sessionStatus)) action = reaction;
                        }
                    }
                }
                if (!action) {
                    signal?.throwIfAborted();
                    publicationInvoked = true;
                    action = row.type === 'reply'
                        ? await createReply(session.fbData, { parentCommentTarget: parent.commentTarget, text: row.text }, { signal })
                        : await createComment(session.fbData, { feedbackId: session.postTarget.postFeedbackId, postTarget: session.postTarget, text: row.text }, { signal });
                }
            } catch (error) {
                action = actionFailure(error);
                if (publicationInvoked && error.mutationAttempted !== false && !error.safeFacebookError) {
                    Object.assign(action, { outcomeUnknown: true, outcome: 'OUTCOME_UNKNOWN', message: 'Публікацію не підтверджено після помилки; повтор не виконується' });
                }
            }
            // Невідомий результат реакції не є невідомим результатом ще не надісланого коментаря.
            if (!publicationInvoked) action = { ...action, success: false, mutationAttempted: false, outcomeUnknown: false, outcome: 'NOT_SENT' };
            await handleRestriction(id, action);
            if (action.success && !action.commentId) action = { ...action, success: false, outcomeUnknown: true, outcome: 'OUTCOME_UNKNOWN', message: 'Facebook не підтвердив ID публікації' };
            Object.assign(row.attempts.at(-1), { status: action.success ? 'success' : action.outcomeUnknown ? 'unknown' : 'failed', ...action });
            const record = { ...action, attemptId, operation: row.type === 'reply' ? 'reply-create' : 'comment-create',
                rowId: row.id, parentRowId: row.parent_id, profileKey: row.profile_key, profileId: id, profileNo: profile.profileNo, text: row.text, postUrl };
            attempts.push(record);
            if (action.success) {
                row.status = 'success'; row.message = action.message;
                row.commentTarget = action.commentTarget ?? { commentId: action.commentId, legacyCommentId: action.legacyCommentId, commentFeedbackId: action.commentFeedbackId, postFeedbackId: session.postTarget.postFeedbackId, postUrl, commentUrl: action.commentUrl, parentCommentId: parent?.commentTarget?.commentId ?? null,
                    threadFeedbackId: parent?.commentTarget?.threadFeedbackId ?? parent?.commentTarget?.commentFeedbackId ?? action.commentFeedbackId };
                if (row.profile_key) assignments[row.profile_key] = id;
            } else {
                broken.add(id);
                row.status = action.outcomeUnknown ? 'unknown' : 'failed';
                row.message = action.message ?? 'Публікацію не підтверджено';
            }
            try { await persist(id, record); }
            catch { stoppedForStorage = true; row.storageWarning = 'Не вдалося зберегти результат; чергу зупинено'; }
            if (!await saveState() || stoppedForStorage) break;
            if (action.success) {
                try { await afterSuccess(profile, row, action); }
                catch { row.counterWarning = 'Публікацію підтверджено; не вдалося синхронізувати лічильник'; }
            }
            if (session && !isSessionUnavailable(action.sessionStatus)) {
                try { await saveSession(id, session.client); }
                catch { row.storageWarning = 'Не вдалося зберегти оновлену сесію'; stoppedForStorage = true; }
            }
            if (action.success || action.outcomeUnknown || row.type === 'reply' || pinned || stoppedForStorage || signal?.aborted) break;
            row.status = 'pending';
        }
        await saveState();
    }
    const summary = {
        comments: queue.filter(r => r.type === 'comment' && r.status === 'success').length,
        replies: queue.filter(r => r.type === 'reply' && r.status === 'success').length,
        failed: queue.filter(r => r.status === 'failed').length, unknown: queue.filter(r => r.status === 'unknown').length,
        skipped: queue.filter(r => r.status === 'skipped').length,
        reactionsAdded: reactions.filter(r => r.success && r.outcome === 'APPLIED').length,
        reactionsExisting: reactions.filter(r => r.success && r.outcome === 'UNCHANGED').length,
        durationMs: Date.now() - startedAt,
    };
    const summaryText = `Коментарі: ${summary.comments} · Реплаї: ${summary.replies} · Помилки: ${summary.failed} · Невідомо: ${summary.unknown} · Пропущено: ${summary.skipped} · Реакції: ${summary.reactionsAdded} нових / ${summary.reactionsExisting} вже були · Час: ${Math.round(summary.durationMs / 1000)} с`;
    await progress({ stage: 'report', completed: queue.filter(r => r.status !== 'pending').length, total: queue.length, message: summaryText });
    return { result: { ...state(), profiles: attempts, summary, summaryText, publishedCount: summary.comments + summary.replies,
        requestedCount: queue.length, skippedCount: summary.skipped, remaining: queue.filter(r => r.status === 'pending').map(r => ({ id: r.id, text: r.text })),
        cancelled: signal?.aborted === true, stoppedForStorage },
        taskStatus: stoppedForStorage || signal?.aborted || queue.some(r => r.status !== 'success' || r.counterWarning || r.storageWarning) || reactions.some(r => !r.success) ? 'completed_with_warnings' : 'completed' };
}
