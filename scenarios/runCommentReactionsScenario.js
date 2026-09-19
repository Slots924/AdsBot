import saveCommentReactionReport from "../services/reports/saveCommentReactionReport.js";
import reactToPostCommentsWithProfile from "../workflows/comments/reactToPostCommentsWithProfile.js";


const validReactions = new Set(["like", "love", "care"]);
const reactionOrder = ["like", "love", "care"];


function normalizeReactions(reactions) {
    return Object.fromEntries([...validReactions].map((reaction) => [
        reaction,
        Math.max(0, Math.floor(Number(reactions?.[reaction]) || 0)),
    ]));
}


export function createReactionQueue(reactions) {
    return reactionOrder.flatMap((reaction) => Array.from(
        { length: reactions[reaction] },
        () => reaction
    ));
}


export default async function runCommentReactionsScenario({
    adsPower,
    profileNos = [],
    postUrl,
    reactions = {},
    includeReplies = false,
    browserMode = "visible",
    disableImages = false,
    workerProxies = {},
    onProxyUnavailable = null,
    signal,
    onProgress,
    reportsDirectory = "./data/reports",
    reactWithProfile = reactToPostCommentsWithProfile,
} = {}) {
    const profiles = [...new Set(profileNos.map((value) => String(value).trim()).filter(Boolean))];
    if (!profiles.length) throw new Error("Оберіть хоча б один профіль AdsPower");
    if (!String(postUrl ?? "").trim()) throw new Error("Вкажіть URL Facebook-поста");
    const normalizedReactions = normalizeReactions(reactions);
    if (!Object.values(normalizedReactions).some(Boolean)) {
        throw new Error("Вкажіть хоча б одну реакцію");
    }
    const report = {
        startedAt: new Date().toISOString(),
        finishedAt: null,
        postUrl: String(postUrl).trim(),
        reactions: normalizedReactions,
        includeReplies: includeReplies === true,
        concurrency: 1,
        profiles: [],
        unusedProfiles: [],
    };
    const pendingReactions = createReactionQueue(normalizedReactions);
    let profileIndex = 0;
    const workers = [1];
    const runWorker = async (workerId) => {
        while (!signal?.aborted && pendingReactions.length > 0 && profileIndex < profiles.length) {
            const assignment = {
                profileNo: profiles[profileIndex],
                reaction: pendingReactions[0],
            };
            profileIndex += 1;
            const startedAt = new Date().toISOString();
            let result;
            try {
                const profile = await adsPower.getProfileByNo(assignment.profileNo);
                result = await reactWithProfile({
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
            if (result.applied > 0) pendingReactions.shift();
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
    report.unusedProfiles = profiles.slice(profileIndex);
    report.unfulfilledReactions = Object.fromEntries(
        reactionOrder.map((reaction) => [
            reaction,
            pendingReactions.filter((item) => item === reaction).length,
        ])
    );
    report.reportPath = await saveCommentReactionReport(report, reportsDirectory);
    return report;
}
