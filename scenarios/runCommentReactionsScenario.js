import { normalizeConcurrency } from "./runParallelCommentingScenario.js";
import saveCommentReactionReport from "../services/reports/saveCommentReactionReport.js";
import reactToPostCommentsWithProfile from "../workflows/comments/reactToPostCommentsWithProfile.js";


const validReactions = new Set(["like", "love", "care"]);


function normalizeReactions(reactions) {
    return Object.fromEntries([...validReactions].map((reaction) => [
        reaction,
        Math.max(0, Math.floor(Number(reactions?.[reaction]) || 0)),
    ]));
}


function createAssignments(profileNos, reactions) {
    const planned = [];
    for (const reaction of ["like", "love", "care"]) {
        planned.push(...Array.from(
            { length: reactions[reaction] },
            () => reaction
        ));
    }
    return {
        assignments: planned.slice(0, profileNos.length).map((reaction, index) => ({
            profileNo: profileNos[index],
            reaction,
        })),
        backupProfiles: profileNos.slice(planned.length),
        missing: Object.fromEntries(["like", "love", "care"].map((reaction) => [
            reaction,
            Math.max(0, reactions[reaction] - profileNos.filter((_, index) => (
                planned[index] === reaction
            )).length),
        ])),
    };
}


export default async function runCommentReactionsScenario({
    adsPower,
    profileNos = [],
    postUrl,
    reactions = {},
    includeReplies = false,
    browserMode = "visible",
    disableImages = false,
    concurrency = 5,
    workerProxies = {},
    onProxyUnavailable = null,
    signal,
    onProgress,
    reportsDirectory = "./data/reports",
} = {}) {
    const profiles = [...new Set(profileNos.map((value) => String(value).trim()).filter(Boolean))];
    if (!profiles.length) throw new Error("Оберіть хоча б один профіль AdsPower");
    if (!String(postUrl ?? "").trim()) throw new Error("Вкажіть URL Facebook-поста");
    const normalizedReactions = normalizeReactions(reactions);
    if (!Object.values(normalizedReactions).some(Boolean)) {
        throw new Error("Вкажіть хоча б одну реакцію");
    }
    const workerLimit = normalizeConcurrency(concurrency);
    const report = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        postUrl: String(postUrl).trim(),
        reactions: normalizedReactions,
        includeReplies: includeReplies === true,
        concurrency: workerLimit,
        profiles: [],
        unusedProfiles: [],
    };
    const plan = createAssignments(profiles, normalizedReactions);
    const pendingAssignments = [...plan.assignments];
    const backupProfiles = [...plan.backupProfiles];
    const fulfilled = { like: 0, love: 0, care: 0 };
    const workers = Array.from({ length: Math.min(workerLimit, plan.assignments.length) }, (_, index) => index + 1);
    const runWorker = async (workerId) => {
        while (!signal?.aborted) {
            const assignment = pendingAssignments.shift();
            if (!assignment) return;
            const startedAt = new Date().toISOString();
            let result;
            try {
                const profile = await adsPower.getProfileByNo(assignment.profileNo);
                result = await reactToPostCommentsWithProfile({
                    adsPower,
                    profile,
                    postUrl: report.postUrl,
                    reaction: assignment.reaction,
                    includeReplies: report.includeReplies,
                    browserMode,
                    disableImages,
                    workerId,
                    workerProxy: workerProxies[workerId] ?? null,
                    onProxyUnavailable,
                    signal,
                });
            } catch (error) {
                result = { profileNo: assignment.profileNo, reaction: assignment.reaction, outcome: "failed", applied: 0, failed: 0, alreadyReacted: 0, error: error.message };
            }
            report.profiles.push({ ...result, startedAt, finishedAt: new Date().toISOString(), workerId });
            if (result.applied > 0) {
                fulfilled[assignment.reaction] += 1;
            } else if (backupProfiles.length > 0) {
                pendingAssignments.push({
                    profileNo: backupProfiles.shift(),
                    reaction: assignment.reaction,
                });
            }
            await onProgress?.({
                completed: report.profiles.length,
                total: profiles.length,
                currentProfileNo: assignment.profileNo,
                workerId,
                message: `Реакції: профіль ${assignment.profileNo}`,
            });
        }
    };
    await Promise.all(workers.map(runWorker));
    report.finishedAt = new Date().toISOString();
    report.unusedProfiles = backupProfiles;
    report.unfulfilledReactions = Object.fromEntries(
        ["like", "love", "care"].map((reaction) => [
            reaction,
            Math.max(0, normalizedReactions[reaction] - fulfilled[reaction]),
        ])
    );
    report.reportPath = await saveCommentReactionReport(report, reportsDirectory);
    return report;
}
