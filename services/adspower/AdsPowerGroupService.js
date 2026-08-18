import {
    mkdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";


function createGroupError(message, code = "ADSPOWER_GROUPS_ERROR") {
    const error = new Error(message);
    error.code = code;
    return error;
}


export function collectUniqueGroups(items) {
    const groupsById = new Map();

    if (!Array.isArray(items)) {
        return [];
    }

    items.forEach((item) => {
        const groupId = String(item?.group_id ?? "").trim();
        const groupName = String(item?.group_name ?? "").trim();

        if (!groupId || groupsById.has(groupId)) {
            return;
        }

        groupsById.set(groupId, {
            groupId,
            groupName,
        });
    });

    return [...groupsById.values()].sort((left, right) =>
        left.groupName.localeCompare(right.groupName, "uk")
        || left.groupId.localeCompare(right.groupId)
    );
}


export default class AdsPowerGroupService {
    constructor({
        adsPower,
        groupsFile = "./data/adspower-groups.json",
    } = {}) {
        if (typeof adsPower?.getProfiles !== "function") {
            throw createGroupError(
                "Не передано коректний AdsPower",
                "ADSPOWER_GROUPS_CONFIG_ERROR"
            );
        }

        this.adsPower = adsPower;
        this.groupsFile = path.resolve(groupsFile);
    }


    /**
     * Читає збережений довідник груп AdsPower.
     * @returns {Promise<Array<{groupId: string, groupName: string}>>}
     */
    async getGroups() {
        let parsed;

        try {
            parsed = JSON.parse(await readFile(this.groupsFile, "utf8"));
        } catch {
            throw createGroupError(
                "Не вдалося прочитати довідник груп AdsPower",
                "ADSPOWER_GROUPS_FILE_ERROR"
            );
        }

        if (!Array.isArray(parsed?.groups)) {
            throw createGroupError(
                "Довідник груп AdsPower має неправильний формат",
                "ADSPOWER_GROUPS_FILE_ERROR"
            );
        }

        return collectUniqueGroups(parsed.groups);
    }


    /**
     * Збирає групи з усіх Profile API V2 pages і атомарно оновлює JSON.
     * @returns {Promise<Array<{groupId: string, groupName: string}>>}
     */
    async refreshGroups() {
        const profiles = await this.adsPower.getProfiles();
        const groups = collectUniqueGroups(profiles);

        if (groups.length === 0) {
            throw createGroupError(
                "AdsPower не повернув жодної групи",
                "ADSPOWER_GROUPS_EMPTY"
            );
        }

        const directory = path.dirname(this.groupsFile);
        const temporaryFile = path.join(
            directory,
            `.adspower-groups-${process.pid}-${Date.now()}.tmp`
        );
        const output = {
            generated_at: new Date().toISOString(),
            source: "profile-api-v2",
            groups: groups.map((group) => ({
                group_id: group.groupId,
                group_name: group.groupName,
            })),
        };

        try {
            await mkdir(directory, { recursive: true });
            await writeFile(
                temporaryFile,
                `${JSON.stringify(output, null, 2)}\n`,
                "utf8"
            );
            await rename(temporaryFile, this.groupsFile);
        } catch {
            await rm(temporaryFile, { force: true }).catch(() => {});
            throw createGroupError(
                "Не вдалося зберегти довідник груп AdsPower",
                "ADSPOWER_GROUPS_FILE_ERROR"
            );
        }

        return groups;
    }
}
