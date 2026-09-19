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
    const availableProfiles = [...profiles];
    const remaining = { ...normalizedReactions };
    const inFlight = { like: 0, love: 0, care: 0 };
    const takeAssignment = () => {
        const reaction = [...validReactions].find((name) => (
            remaining[name] > inFlight[name]
        ));
        const profileNo = availableProfiles.shift();
        if (!reaction || !profileNo) return null;
        inFlight[reaction] += 1;
        return { profileNo, reaction };
    };
    const workers = Array.from({ length: Math.min(workerLimit, profiles.length) }, (_, index) => index + 1);
    const runWorker = async (workerId) => {
        while (!signal?.aborted) {
            const assignment = takeAssignment();
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
            inFlight[assignment.reaction] -= 1;
            if (result.applied > 0) remaining[assignment.reaction] -= 1;
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
    report.unusedProfiles = availableProfiles;
    report.unfulfilledReactions = remaining;
    report.reportPath = await saveCommentReactionReport(report, reportsDirectory);
    return report;
}
