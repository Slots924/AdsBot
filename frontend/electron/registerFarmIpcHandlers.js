import FarmService from "../../services/farming/FarmService.js";

export default function registerFarmIpcHandlers({ ipcMain, safeHandler, profileActivityStore, guiService, backgroundTaskManager }) {
    if (!profileActivityStore?.farm) return;
    const service = new FarmService({ activityStore: profileActivityStore, guiService });
    const handle = (channel, handler) => ipcMain.handle(channel, safeHandler(handler));
    handle("farm:snapshot", (payload) => service.snapshot(payload?.groupId));
    handle("farm:group-save", (payload) => service.store.saveGroup(payload));
    handle("farm:group-delete", ({ id }) => service.store.deleteGroup(id));
    handle("farm:assign", (payload) => service.assign(payload));
    handle("farm:settings-save", (payload) => service.store.saveSettings(payload));
    handle("farm:pool-save", ({ pool }) => service.store.savePool(pool));
    handle("farm:run", async (payload) => {
        const prepared = await service.prepareRun(payload);
        const task = await backgroundTaskManager.enqueue({
            type: "account-farm", name: `Фарм акаунтів (${prepared.members.length})`,
            resources: prepared.members.map((member) => ({ key: `adspower-profile:${member.profileNo}`, label: `AdsPower ${member.profileNo}` })),
            input: { groupId: prepared.groupId, profileNos: prepared.members.map((m) => m.profileNo), settings: prepared.settings },
            metadata: { groupId: prepared.groupId, profileNos: prepared.members.map((m) => m.profileNo) },
            uniqueKey: `farm:${prepared.members.map((m) => m.profileNo).sort().join(",")}`,
            runner: async ({ signal, progress }) => {
                const result = await service.run(prepared, { signal, onProgress: progress });
                return { result, taskStatus: result.outcome === "completed" ? "completed" : "completed_with_warnings",
                    reportDetails: { inputSummary: { groupId: prepared.groupId, settings: prepared.settings }, resultSummary: result } };
            },
        });
        return { taskId: task.id, task };
    });
}
