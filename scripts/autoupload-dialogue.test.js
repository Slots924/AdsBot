import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import FacebookWebClient from '../facebook/api/FacebookWebClient.js';
import getPostContext from '../facebook/autoupload/actions/posts/getPostContext.js';
import getPostReaction from '../facebook/autoupload/actions/reactions/getPostReaction.js';
import getCommentReaction from '../facebook/autoupload/actions/reactions/getCommentReaction.js';
import setPostReaction from '../facebook/autoupload/actions/reactions/setPostReaction.js';
import setCommentReaction from '../facebook/autoupload/actions/reactions/setCommentReaction.js';
import createReply from '../facebook/autoupload/actions/comments/createReply.js';
import createComment from '../facebook/autoupload/actions/comments/createComment.js';
import { reactionIds } from '../facebook/autoupload/actions/reactions/common.js';
import runDialogue, { prepareDialogue } from '../services/autoupload/commentDialogue.js';
import AutouploadStore from '../services/autoupload/AutouploadStore.js';
import AutouploadService from '../services/autoupload/AutouploadService.js';
import TaskReportManager from '../services/reports/TaskReportManager.js';

const encode = value => Buffer.from(value).toString('base64');
const postUrl = 'https://www.facebook.com/permalink.php?story_fbid=pfbidTest123&id=456';
const postTarget = { postUrl, postId: '123', postFeedbackId: encode('feedback:pfbidTest123') };
const parentTarget = { postUrl, postFeedbackId: postTarget.postFeedbackId, commentId: encode('comment:123_789'), legacyCommentId: '789', commentFeedbackId: encode('feedback:parent'), commentUrl: `${postUrl}&comment_id=789` };
const sessionHtml = 'DTSGInitialData",[],{"token":"fake-dtsg"} LSD",[],{"token":"fake-lsd"} <input name="jazoest" value="2123"> {"sessionId":"fake-session","actorID":"123","client_revision":456}';
const response = data => ({ status: 200, headers: {}, data: typeof data === 'string' ? data : JSON.stringify(data) });
function postHtml(postReaction = null, commentReaction = null, { missing = false, unrelated = false } = {}) {
    const feedback = id => ({ id, ...(missing ? {} : { viewer_feedback_reaction_info: id === postTarget.postFeedbackId ? postReaction : commentReaction }) });
    const story = { __typename: 'Story', post_id: '123', permalink_url: postUrl, feedback: feedback(postTarget.postFeedbackId),
        comments: [{ __typename: 'Comment', id: parentTarget.commentId, legacy_fbid: '789', feedback: feedback(parentTarget.commentFeedbackId) }] };
    return `<script type="application/json">${JSON.stringify({ data: { node: unrelated ? { ...story, permalink_url: 'https://www.facebook.com/permalink.php?story_fbid=unrelated', post_id: '999' } : story } })}</script>`;
}
async function fixture({ get = () => postHtml(), post } = {}) {
    const calls = [];
    const client = new FacebookWebClient({ userAgent: 'Test-UA', cookies: ['c_user', 'xs'].map(name => ({ name, value: name === 'c_user' ? '123' : 'fake-xs', domain: '.facebook.com', path: '/', secure: true })),
        httpClient: { request: async (config, options) => {
            calls.push({ config, options });
            if (config.method === 'get') return response(config.url === 'https://www.facebook.com/' ? sessionHtml : get(config));
            return post(config);
        } },
    });
    await client.checkSession();
    return { fbData: client.getFbData('test'), calls };
}

test('читання підтверджує потрібний пост, а відсутнє поле реакції не стає null', async () => {
    const f = await fixture();
    const result = await getPostContext(f.fbData, { postUrl });
    assert.equal(result.success, true);
    assert.equal(result.reactionKnown, true);
    assert.equal(result.reaction, null);
    assert.equal(result.postFeedbackId, postTarget.postFeedbackId);
    for (const get of [() => '<html>Facebook</html>', () => postHtml(null, null, { unrelated: true })]) {
        const wrong = await fixture({ get });
        assert.equal((await getPostContext(wrong.fbData, { postUrl })).success, false);
    }
    const absent = await fixture({ get: () => postHtml(null, null, { missing: true }) });
    const partial = await getPostContext(absent.fbData, { postUrl });
    assert.equal(partial.success, true);
    assert.equal(partial.reactionKnown, false);
    assert.equal((await getPostReaction(absent.fbData, { postTarget })).success, false);
    assert.equal((await getCommentReaction(absent.fbData, { commentTarget: parentTarget })).success, false);
    assert.equal((await getPostReaction(f.fbData, { postTarget: { ...postTarget, postFeedbackId: encode('feedback:wrong') } })).success, false);
});

test('реакція коментаря зіставляється з його ID, legacy ID та feedback, а не з реакцією поста', async () => {
    const f = await fixture({ get: () => postHtml({ id: reactionIds.love }, null) });
    const read = await getCommentReaction(f.fbData, { commentTarget: parentTarget });
    assert.equal(read.success, true);
    assert.equal(read.reaction, null);
    assert.ok(f.calls.at(-1).config.url.includes('comment_id=789'));
    for (const patch of [{ commentId: 'wrong' }, { legacyCommentId: '000' }, { commentFeedbackId: encode('feedback:wrong') }, { postFeedbackId: encode('feedback:wrong') }]) {
        assert.equal((await getCommentReaction(f.fbData, { commentTarget: { ...parentTarget, ...patch } })).success, false);
    }
});

for (const kind of ['post', 'comment']) {
    const set = kind === 'post' ? setPostReaction : setCommentReaction;
    const input = kind === 'post' ? { postTarget } : { commentTarget: parentTarget };
    const feedbackId = kind === 'post' ? postTarget.postFeedbackId : parentTarget.commentFeedbackId;
    for (const [name, id] of Object.entries(reactionIds)) {
        test(`${kind}: ${name}, видалення та незмінений стан підтверджуються без повтору POST`, async () => {
            let current = null;
            const f = await fixture({ get: () => postHtml(kind === 'post' ? current : null, kind === 'comment' ? current : null), post: config => {
                const form = new URLSearchParams(config.data);
                assert.equal(form.get('fb_api_req_friendly_name'), 'CometUFIFeedbackReactMutation');
                const variables = JSON.parse(form.get('variables'));
                assert.equal(variables.input.feedback_id, feedbackId);
                current = variables.input.feedback_reaction_id === '0' ? null : { id: variables.input.feedback_reaction_id };
                return response({ data: { feedback_react: { feedback: { id: feedbackId, viewer_feedback_reaction_info: current } } } });
            } });
            const applied = await set(f.fbData, { ...input, reaction: name });
            assert.equal(applied.success, true);
            assert.equal(applied.reaction.id, id);
            assert.equal((await set(f.fbData, { ...input, reaction: name })).outcome, 'UNCHANGED');
            const removed = await set(f.fbData, { ...input, reaction: null });
            assert.equal(removed.success, true);
            assert.equal(removed.reaction, null);
            assert.equal(f.calls.filter(c => c.config.method === 'post').length, 2);
            assert.ok(f.calls.filter(c => c.config.method === 'post').every(c => c.options.retryOnConnectionError === false));
            assert.ok(!JSON.stringify(applied).includes('fake-dtsg'));
        });
    }
}

test('реакція: один контрольний GET, без POST при невідомому стані, timeout і часткова помилка', async () => {
    let current = null;
    const f = await fixture({ get: () => postHtml(current), post: () => { current = { id: reactionIds.wow }; return response({ data: { feedback_react: {} } }); } });
    assert.equal((await setPostReaction(f.fbData, { postTarget, reaction: 'wow' })).success, true);
    assert.equal(f.calls.filter(c => c.config.url !== 'https://www.facebook.com/' && c.config.method === 'get').length, 2);
    const absent = await fixture({ get: () => postHtml(null, null, { missing: true }) });
    assert.equal((await setPostReaction(absent.fbData, { postTarget, reaction: 'love' })).mutationAttempted, false);
    assert.equal(absent.calls.filter(c => c.config.method === 'post').length, 0);
    for (const post of [() => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }, () => response('invalid'),
        () => response({ data: { feedback_react: { feedback: { id: postTarget.postFeedbackId, viewer_feedback_reaction_info: { id: reactionIds.love } } } }, errors: [{ code: 123, message: 'Partial' }] })]) {
        const broken = await fixture({ post });
        const result = await setPostReaction(broken.fbData, { postTarget, reaction: 'love' });
        assert.equal(result.success, false); assert.equal(result.outcomeUnknown, true);
        assert.equal(broken.calls.filter(c => c.config.method === 'post').length, 1);
    }
});

test('reply використовує GraphQL ID батька й його feedback та підтверджує зв’язок', async () => {
    const created = parent => ({ data: { comment_create: { feedback: { id: parentTarget.commentFeedbackId }, feedback_comment_edge: { node: {
        id: encode('comment:123_999'), legacy_fbid: '999', feedback: { id: encode('feedback:reply') }, comment_direct_parent: { id: parent }, body: { text: 'Reply' },
    } } } } });
    const f = await fixture({ post: config => {
        const variables = JSON.parse(new URLSearchParams(config.data).get('variables'));
        assert.equal(variables.input.feedback_id, parentTarget.commentFeedbackId);
        assert.equal(variables.input.reply_comment_parent_fbid, parentTarget.commentId);
        assert.deepEqual(variables.input.message.ranges, []);
        return response(created(parentTarget.commentId));
    } });
    const result = await createReply(f.fbData, { parentCommentTarget: parentTarget, text: 'Reply' });
    assert.equal(result.success, true);
    assert.equal(result.commentTarget.parentCommentId, parentTarget.commentId);
    assert.equal(result.commentTarget.postFeedbackId, postTarget.postFeedbackId);
    assert.equal(result.commentTarget.postUrl, postUrl);
    for (const parent of ['wrong', undefined]) {
        const wrong = await fixture({ post: () => response(created(parent)) });
        const r = await createReply(wrong.fbData, { parentCommentTarget: parentTarget, text: 'Reply' });
        assert.equal(r.outcomeUnknown, true);
        assert.equal(wrong.calls.filter(c => c.config.method === 'post').length, 1);
    }
    const invalid = await createReply(f.fbData, { parentCommentTarget: { ...parentTarget, commentId: '789' }, text: 'Reply' });
    assert.equal(invalid.mutationAttempted, false);
});

test('явна відмова, скасування й невідповідний feedback не дають хибного успіху', async () => {
    const f = await fixture({ post: () => response({ errors: [{ code: 123, message: 'Rejected' }] }) });
    const rejected = await setPostReaction(f.fbData, { postTarget, reaction: 'love' });
    assert.equal(rejected.outcomeUnknown, false);
    const cancelled = await setPostReaction(f.fbData, { postTarget, reaction: 'love' }, { signal: AbortSignal.abort() });
    assert.equal(cancelled.mutationAttempted, false);
    const wrong = await fixture({ post: () => response({ data: { comment_create: { feedback: { id: 'wrong' }, feedback_comment_edge: { node: { id: 'created' } } } } }) });
    assert.equal((await createComment(wrong.fbData, { feedbackId: postTarget.postFeedbackId, text: 'Text' })).outcomeUnknown, true);
});

test('відповідь на reply використовує feedback кореня гілки та ID безпосереднього батька', async () => {
    const nestedParent = { ...parentTarget, threadFeedbackId: encode('feedback:thread-root') };
    const f = await fixture({ post: config => {
        const input = JSON.parse(new URLSearchParams(config.data).get('variables')).input;
        assert.equal(input.feedback_id, nestedParent.threadFeedbackId);
        assert.equal(input.reply_comment_parent_fbid, nestedParent.commentId);
        return response({ data: { comment_create: { feedback: { id: nestedParent.threadFeedbackId }, feedback_comment_edge: { node: {
            id: encode('comment:123_nested'), legacy_fbid: '999', feedback: { id: encode('feedback:nested') }, comment_direct_parent: { id: nestedParent.commentId },
        } } } } });
    } });
    const result = await createReply(f.fbData, { parentCommentTarget: nestedParent, text: 'Nested reply' });
    assert.equal(result.success, true);
    assert.equal(result.commentTarget.threadFeedbackId, nestedParent.threadFeedbackId);
    assert.equal(result.commentTarget.parentCommentId, nestedParent.commentId);
    assert.equal(result.commentTarget.commentFeedbackId, encode('feedback:nested'));
});

const row = (id, parent_id = null, profile_key = null, gender = 'male') => ({ id, parent_id, profile_key, gender, text: `Text ${id}`, should_write: true });
const profiles = [{ profileId: 'm1', profileNo: '1', gender: 'male' }, { profileId: 'f1', profileNo: '2', gender: 'female' }, { profileId: 'm2', profileNo: '3', gender: 'male' }];
function queueFixture(rows, overrides = {}) {
    const sent = [], saved = [], reactions = [], prepared = [];
    const create = async (data, input) => {
        sent.push([data.profileId, input.text, input.parentCommentTarget?.commentId ?? null]);
        const id = encode(`comment:123_${sent.length}`);
        return { success: true, commentId: id, message: 'Створено', commentTarget: { ...parentTarget, commentId: id } };
    };
    const options = { rows, profiles, postUrl, random: () => 0.8,
        prepare: async profile => { prepared.push(profile.profileId); return { client: { getFbData: id => ({ profileId: id }) } }; },
        getPostContext: async () => ({ success: true, postTarget, reaction: null, reactionKnown: true }),
        setPostReaction: async (data, input) => { reactions.push([data.profileId, input.reaction]); return { success: true, outcome: 'APPLIED' }; },
        createComment: create, createReply: create, persist: async () => {}, persistState: async state => saved.push(structuredClone(state)), ...overrides };
    return { run: () => runDialogue(options), options, sent, saved, reactions, prepared };
}

test('діалог впорядковує батьків, закріплює двох учасників і реагує один раз від профілю', async () => {
    const f = queueFixture([row('3', '2', 'a'), row('2', '1', 'b', 'female'), row('1', null, 'a')]);
    const { result } = await f.run();
    assert.deepEqual(f.sent.map(([id, text]) => [id, text]), [['m1', 'Text 1'], ['f1', 'Text 2'], ['m1', 'Text 3']]);
    assert.equal(f.sent[1][2], encode('comment:123_1'));
    assert.equal(f.sent[2][2], encode('comment:123_2'));
    assert.deepEqual(result.assignments, { a: 'm1', b: 'f1' });
    assert.deepEqual(f.reactions, [['m1', 'wow'], ['f1', 'wow']]);
    assert.deepEqual(f.prepared, ['m1', 'f1']);
    assert.equal(result.summary.comments, 1); assert.equal(result.summary.replies, 2);
    assert.ok(f.saved.some(s => s.rows[0].attempts[0]?.status === 'started'));
});

test('звичайний коментар змінює профіль після відмови; reply та прив’язана репліка не повторюються', async () => {
    const f = queueFixture([row('1', null, 'a'), row('2', '1', 'b', 'female'), row('3', '2'), row('4', null, 'a')]);
    const create = f.options.createComment;
    let calls = 0;
    f.options.createComment = async (...args) => ++calls === 1 ? { success: false, message: 'Rejected' } : create(...args);
    f.options.createReply = async () => ({ success: false, message: 'Rejected reply' });
    const { result } = await f.run();
    assert.equal(result.rows[0].attempts.length, 2);
    assert.equal(result.rows[1].attempts.length, 1);
    assert.equal(result.rows[2].status, 'skipped');
    assert.equal(result.rows[3].profileId, 'm2');
    assert.equal(result.rows[3].status, 'success');
});

test('невідомий POST не повторюється; нащадки пропускаються, незалежна гілка продовжується', async () => {
    const f = queueFixture([row('1'), row('2', '1'), row('3', null, null, 'female')]);
    const create = f.options.createComment;
    f.options.createComment = async (data, input) => input.text === 'Text 1' ? { success: false, outcomeUnknown: true, message: 'Timeout' } : create(data, input);
    const { result } = await f.run();
    assert.equal(result.rows[0].attempts.length, 1);
    assert.equal(result.rows[0].status, 'unknown');
    assert.equal(result.rows[1].status, 'skipped');
    assert.equal(result.rows[2].status, 'success');
});

test('помилка підготовки reply витрачає єдину спробу; прив’язаний профіль не замінюється', async () => {
    const f = queueFixture([row('1', null, 'a'), row('2', '1', 'b', 'female'), row('3', null, 'a'), row('4', null, 'a')]);
    const prepare = f.options.prepare;
    f.options.prepare = async profile => profile.gender === 'female' ? { client: null, result: { status: 'login_required', message: 'Login' } } : prepare(profile);
    const create = f.options.createComment;
    f.options.createComment = async (data, input) => input.text === 'Text 3' ? { success: false, message: 'No' } : create(data, input);
    const { result } = await f.run();
    assert.equal(result.rows[1].attempts.length, 1);
    assert.equal(result.rows[2].attempts.length, 1);
    assert.equal(result.rows[3].status, 'skipped');
    assert.equal(result.assignments.a, 'm1');
});

test('авторські гілки пропускаються, цикли, повторні ID та змішана стать учасника відхиляються', async () => {
    const f = queueFixture([{ ...row('1'), is_author: true }, row('2', '1'), { ...row('3'), should_write: false }, row('4', '3')]);
    const { result } = await f.run();
    assert.ok(result.rows.every(r => r.status === 'skipped'));
    assert.equal(f.sent.length, 0);
    assert.throws(() => prepareDialogue([row('1', '2'), row('2', '1')]));
    assert.throws(() => prepareDialogue([row('1'), row('1')]));
    assert.throws(() => prepareDialogue([row('1', null, 'a'), row('2', null, 'a', 'female')]));
});

test('збій або невідомий стан реакції не блокують коментар, але помилка сесії блокує', async () => {
    for (const mode of ['unknown', 'failed', 'existing', 'session']) {
        const f = queueFixture([row('1')], { profiles: profiles.slice(0, 1) });
        if (mode === 'unknown') f.options.getPostContext = async () => ({ success: true, postTarget, reactionKnown: false });
        if (mode === 'existing') f.options.getPostContext = async () => ({ success: true, postTarget, reactionKnown: true, reaction: { name: 'angry', id: reactionIds.angry } });
        if (mode === 'failed' || mode === 'session') f.options.setPostReaction = async () => ({ success: false, ...(mode === 'session' ? { sessionStatus: 'login_required' } : {}) });
        const { result } = await f.run();
        assert.equal(result.rows[0].status, mode === 'session' ? 'failed' : 'success');
        if (mode === 'unknown' || mode === 'existing') assert.equal(f.reactions.length, 0);
    }
});

test('збій збереження й скасування зупиняють чергу без повторної публікації', async () => {
    const f = queueFixture([row('1'), row('2')], { persist: async () => { throw new Error('Disk'); } });
    const result = await f.run();
    assert.equal(f.sent.length, 1); assert.equal(result.result.stoppedForStorage, true);
    const before = queueFixture([row('1')], { persistState: async () => { throw new Error('Disk'); } });
    await before.run(); assert.equal(before.sent.length, 0);
    const controller = new AbortController();
    const aborted = queueFixture([row('1'), row('2')], { signal: controller.signal });
    const create = aborted.options.createComment;
    aborted.options.createComment = async (...args) => { const result = await create(...args); controller.abort(); return result; };
    assert.equal((await aborted.run()).result.cancelled, true); assert.equal(aborted.sent.length, 1);
});

test('неочікуваний виняток публікації не дозволяє сліпий повтор, а збій реакції до коментаря дозволяє інший профіль', async () => {
    const thrown = queueFixture([row('1'), row('2', '1')], { createComment: async () => { throw new Error('Connection lost'); } });
    const result = await thrown.run();
    assert.equal(result.result.rows[0].status, 'unknown');
    assert.equal(result.result.rows[0].attempts.length, 1);
    assert.equal(result.result.rows[1].status, 'skipped');
    const before = queueFixture([row('1')]);
    before.options.setPostReaction = async data => data.profileId === 'm1' ? { success: false, outcomeUnknown: true, sessionStatus: 'login_required', message: 'Login' } : { success: true, outcome: 'APPLIED' };
    const output = await before.run();
    assert.equal(output.result.rows[0].status, 'success');
    assert.equal(output.result.rows[0].attempts.length, 2);
    assert.equal(output.result.rows[0].attempts[0].mutationAttempted, false);
    assert.equal(output.result.rows[0].attempts[0].outcomeUnknown, false);
});

test('інтеграція зберігає діалог, AU_COMMENT/AU_REPLY і компактний звіт без змін проксі', async t => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'adsbot-dialogue-'));
    t.after(async () => { assert.equal(path.dirname(dir), os.tmpdir()); await rm(dir, { recursive: true, force: true }); });
    const store = new AutouploadStore(path.join(dir, 'state.json'));
    const names = { m1: 'Test', f1: 'Test', m2: 'Test' };
    const f = queueFixture([row('1', null, 'a'), row('2', '1', 'a')]);
    const service = new AutouploadService({ store, adsPower: { getProfileById: async id => ({ name: names[id] }), updateProfileName: async (id, name) => { names[id] = name; }, updateProfileProxy: () => assert.fail('Проксі не змінюємо') },
        prepareCommentSession: async ({ profileId }) => ({ client: { getFbData: () => ({ profileId }) } }),
        getPostContextFn: f.options.getPostContext, setPostReactionFn: f.options.setPostReaction, createCommentFn: f.options.createComment, createReplyFn: f.options.createReply });
    const output = await service.publishDialogue(['m1'], { postUrl, commentRows: f.options.rows }, { profiles: [profiles[0]] });
    const state = await store.snapshot();
    assert.equal(state.actionCounters.m1.values.AU_COMMENT, 1); assert.equal(state.actionCounters.m1.values.AU_REPLY, 1);
    assert.equal(state.commentDialogues[output.result.runId].rows[1].status, 'success');
    assert.ok(names.m1.includes('AU_REPLY=1'));
    const manager = new TaskReportManager({ reportsDirectory: path.join(dir, 'reports') });
    const report = await manager.createFromTask({ type: 'autoupload-comments', name: 'AU Comments', result: output.result });
    assert.equal(report.resultSummary.rows[1].attempts[0].commentTarget.commentId, output.result.rows[1].commentTarget.commentId);
    const exported = path.join(dir, 'report.md');
    await manager.exportMarkdown(report.id, exported);
    assert.ok((await readFile(exported, 'utf8')).includes('Рядок / батько'));
});
