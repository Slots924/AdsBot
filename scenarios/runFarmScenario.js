import { randomUUID } from "node:crypto";
import executeFarmWithProfile, { awaitFarmStage } from "../workflows/profile/executeFarmWithProfile.js";

export default async function runFarmScenario({ adsPower, store, groupId, members, settings, pool, signal: parentSignal,
    onProgress = async () => {}, execute = executeFarmWithProfile }) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, parentSignal].filter(Boolean));
    const run = await store.createRun(groupId, members, settings, pool);
    const results = [];
    let index = 0;
    try {
        const workers = Array.from({ length: Math.min(settings.workers, members.length) }, async (_, worker) => {
            while (!signal?.aborted && index < members.length) {
                const member = members[index++];
                const session = { id: randomUUID(), runId: run.id, groupId, profileNo: member.profileNo,
                    worker: worker + 1, startedAt: new Date().toISOString(), outcome: "running", events: [], settings,
                    farmStartedAt: null, farmTimeMs: 0 };
                const persist = async () => {
                    session.updatedAt = new Date().toISOString();
                    if (session.farmStartedAt) session.farmTimeMs = Math.max(0, Date.parse(session.updatedAt) - Date.parse(session.farmStartedAt));
                    await store.saveSession(session);
                };
                await persist();
                try {
                    const profile = await awaitFarmStage(() => adsPower.getProfileByNo(member.profileNo), signal);
                    if (signal?.aborted) {
                        session.outcome = "cancelled";
                    } else {
                        await store.activityStore.syncProfileGroups([profile]);
                        await store.updateProfile(member.profileNo, {
                            profileId: String(profile.profile_id), name: String(profile.name ?? ""),
                            adsPowerGroupId: String(profile.group_id ?? ""), adsPowerGroupName: String(profile.group_name ?? ""),
                        });
                        Object.assign(session, await execute({ adsPower, profile, settings, pool, signal,
                            onFarmStart: async (stamp) => { session.farmStartedAt = stamp; await persist(); },
                            onState: async (state) => {
                                await store.updateProfile(member.profileNo, state);
                                if (state.state === "banned") await store.activityStore.markBanned(member.profileNo);
                            },
                            onEvent: async (event) => {
                                session.events.push({ ...event, at: new Date().toISOString() });
                                await persist();
                                await onProgress({ stage: "farm", completed: results.length, total: members.length,
                                    currentProfileNo: member.profileNo, workerId: worker + 1, message: `Фарм №${member.profileNo}: ${event.action}` });
                            },
                        }));
                    }
                } catch (error) { session.outcome = signal?.aborted ? "cancelled" : "failed"; session.reason = error.message; }
                session.finishedAt = new Date().toISOString();
                session.updatedAt = session.finishedAt;
                await store.saveSession(session);
                results.push(session);
                await onProgress({ completed: results.length, total: members.length, currentProfileNo: member.profileNo,
                    message: `Фарм №${member.profileNo}: ${session.outcome}` });
            }
        }).map((worker) => worker.catch((error) => { controller.abort(error); throw error; }));
        // У разі помилки одного воркера дочікуємося очищення всіх інших перед звільненням ресурсів.
        const settled = await Promise.allSettled(workers);
        const failed = settled.find((item) => item.status === "rejected");
        if (failed) throw failed.reason;
        run.outcome = signal?.aborted ? "cancelled" : results.some((s) => !["completed", "skipped"].includes(s.outcome)) ? "completed_with_warnings" : "completed";
    } catch (error) { run.outcome = "failed"; run.reason = error.message; throw error; }
    finally { run.finishedAt = new Date().toISOString(); await store.saveRun(run); }
    return { ...run, sessions: results, unstartedProfileNos: members.slice(index).map((m) => m.profileNo) };
}
