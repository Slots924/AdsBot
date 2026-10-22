import runFarmScenario from "../../scenarios/runFarmScenario.js";
import { normalizeFarmSettings } from "./farmSettings.js";
import hasBanTag from "../profile/tags/hasBanTag.js";

export default class FarmService {
    constructor({ activityStore, guiService }) { this.store = activityStore.farm; this.gui = guiService; }
    async snapshot(groupId) {
        return { groups: await this.store.groups(), settings: await this.store.settings(), pool: await this.store.pool(),
            members: groupId ? await this.store.members(groupId) : [], history: groupId ? await this.store.history(groupId) : { runs: [], memberships: [] } };
    }
    async assign({ groupId, profileNos }) {
        const numbers = [...new Set((profileNos ?? []).map(String))];
        if (!numbers.length) throw new Error("Оберіть акаунти");
        if (!groupId) return this.store.assign(null, numbers.map((profileNo) => ({ profileNo })));
        const profiles = [];
        for (const profileNo of numbers) {
            const profile = await this.gui.adsPower.getProfileByNo(profileNo);
            if (hasBanTag(profile)) await this.store.activityStore.markBanned(profileNo);
            profiles.push({ profileNo: String(profile.profile_no), profileId: String(profile.profile_id), name: String(profile.name ?? ""),
                adsPowerGroupId: String(profile.group_id ?? ""), adsPowerGroupName: String(profile.group_name ?? "") });
        }
        if (!profiles.length) throw new Error("Оберіть акаунти");
        return this.store.assign(groupId, profiles);
    }
    async prepareRun({ groupId, profileNos, actions }) {
        await this.store.requireGroup(groupId);
        const selected = new Set((profileNos ?? []).map(String));
        const members = (await this.store.members(groupId)).filter((member) => selected.has(member.profileNo));
        if (!members.length || members.length !== selected.size) throw new Error("Оберіть акаунти поточної групи");
        const settings = normalizeFarmSettings({ ...await this.store.settings(), ...(actions ? { actions } : {}) });
        if (!Object.values(settings.actions).some((action) => action.enabled)) throw new Error("Оберіть хоча б одну дію фарму");
        const pool = await this.store.pool();
        if ((settings.actions.groups.enabled || settings.actions.joinGroups.enabled) && !pool.some((item) => item.enabled)) throw new Error("Увімкніть хоча б одну Facebook-групу в пулі");
        return { groupId, members, settings, pool };
    }
    async run(prepared, options) {
        // Перед виконанням повторно перевіряємо членство після очікування у черзі.
        const current = new Set((await this.store.members(prepared.groupId)).map((member) => member.profileNo));
        await this.store.requireGroup(prepared.groupId);
        if (prepared.members.some((member) => !current.has(member.profileNo))) throw new Error("Склад групи змінився після постановки задачі в чергу");
        return runFarmScenario({ ...prepared, ...options, adsPower: this.gui.adsPower, store: this.store });
    }
}
