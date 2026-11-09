import 'dotenv/config';
import path from 'node:path';
import AdsPower from '../../classes/AdsPower.js';
import AutouploadService from '../../services/autoupload/AutouploadService.js';
import AutouploadStore from '../../services/autoupload/AutouploadStore.js';
import TaskReportManager from '../../services/reports/TaskReportManager.js';
import checkProfileSession from '../../workflows/autoupload/checkProfileSession.js';
import getCommentReaction from '../../facebook/autoupload/actions/reactions/getCommentReaction.js';
import getProfileGender from '../../services/profile/getProfileGender.js';

// Скрипт публікує тестовий діалог лише у явно вибраних профілях.
const [firstNo, postUrl, secondNo] = process.argv.slice(2);
if (!/^\d+$/.test(firstNo ?? '') || !postUrl || (secondNo && !/^\d+$/.test(secondNo))) {
    console.log('Використання: node scripts/manual/testCommentDialogueHttp.js <profileNo> <postUrl> [secondProfileNo]');
    process.exitCode = 1;
} else {
    try {
        const adsPower = new AdsPower();
        const profiles = [];
        for (const number of [firstNo, secondNo].filter(Boolean)) {
            const profile = await adsPower.getProfileByNo(Number(number));
            if (!profile) throw new Error('Тестовий профіль не знайдено');
            profiles.push({ profileId: String(profile.profile_id), profileNo: String(profile.profile_no), gender: getProfileGender(profile) ?? 'male' });
        }
        if (profiles.length === 2 && profiles[0].profileId === profiles[1].profileId) throw new Error('Другий учасник має використовувати інший профіль');
        const directory = path.resolve('artifacts/http-comment-dialogue-check');
        const clients = new Map();
        const service = new AutouploadService({ adsPower, store: new AutouploadStore(path.join(directory, 'state.json')),
            reportManager: new TaskReportManager({ reportsDirectory: path.join(directory, 'reports') }),
            prepareCommentSession: async options => {
                const prepared = await checkProfileSession(options);
                if (prepared.client) clients.set(options.profileId, prepared.client);
                return prepared;
            },
        });
        const second = profiles[1] ?? profiles[0];
        const stamp = new Date().toISOString();
        const row = (id, parent_id, actor, text) => ({ id, parent_id, profile_key: actor === profiles[0] ? 'first' : 'second', gender: actor.gender, text, should_write: true, is_author: false });
        const result = await service.publishDialogue(profiles.map(p => p.profileId), { postUrl, commentRows: [
            row('1', null, profiles[0], `HTTP dialogue test ${stamp}`),
            row('2', '1', second, 'HTTP reply transport verified.'),
            row('3', '2', profiles[0], 'HTTP returning participant verified.'),
        ] }, { profiles });
        console.log(result.result.summaryText);
        console.log('REPORT_SAVED', Boolean(result.reportId));
        for (const row of result.result.rows) {
            if (row.status !== 'success') { console.log('ROW', row.id, row.status, row.attempts.at(-1)?.code ?? 'NOT_SENT'); continue; }
            const read = await getCommentReaction(clients.get(row.profileId).getFbData(row.profileId), { commentTarget: row.commentTarget });
            console.log('ROW', row.id, row.status, 'READ_CONFIRMED', read.success);
            if (!read.success) process.exitCode = 1;
        }
        if (result.result.publishedCount !== 3) process.exitCode = 1;
    } catch (error) {
        console.log('Перевірку не завершено:', error.code ?? 'HTTP_DIALOGUE_TEST_FAILED');
        process.exitCode = 1;
    }
}
