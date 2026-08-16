import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import AdsPower from "../classes/AdsPower.js";


const outputFilePath = "./data/adspower-groups.json";


export function collectUniqueGroups(items) {
    const groupsById = new Map();

    items.forEach((item) => {
        const groupId = String(item?.group_id ?? "").trim();
        const groupName = String(item?.group_name ?? "").trim();

        if (!groupId || groupsById.has(groupId)) {
            return;
        }

        groupsById.set(groupId, {
            group_id: groupId,
            group_name: groupName,
        });
    });

    return [...groupsById.values()].sort((left, right) =>
        left.group_name.localeCompare(right.group_name, "uk")
        || left.group_id.localeCompare(right.group_id)
    );
}


export async function getGroupsWithFallback(adsPower) {
    try {
        console.log("Отримуємо групи через Group API V1...");

        return {
            source: "group-api-v1",
            groups: collectUniqueGroups(await adsPower.getGroups()),
        };
    } catch (error) {
        const status = error.status ?? error.response?.status;

        if (status !== 400) {
            throw error;
        }

        console.warn(
            "Group API V1 повернув HTTP 400, переходимо до Profile API V2:",
            error.message
        );
    }

    console.log("Отримуємо всі профілі через Profile API V2...");

    return {
        source: "profile-api-v2",
        groups: collectUniqueGroups(await adsPower.getProfiles()),
    };
}


export async function exportAdsPowerGroups(
    adsPower,
    targetFilePath = outputFilePath
) {
    const result = await getGroupsWithFallback(adsPower);

    if (result.groups.length === 0) {
        throw new Error("AdsPower не повернув жодної групи");
    }

    const absoluteOutputPath = path.resolve(targetFilePath);
    const output = {
        generated_at: new Date().toISOString(),
        source: result.source,
        groups: result.groups,
    };

    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(
        absoluteOutputPath,
        `${JSON.stringify(output, null, 2)}\n`,
        "utf8"
    );

    return {
        output,
        absoluteOutputPath,
    };
}


async function testExportAdsPowerGroups() {
    const adsPower = new AdsPower();
    const { output, absoluteOutputPath } =
        await exportAdsPowerGroups(adsPower);

    console.log(`Джерело: ${output.source}`);
    console.log(`Знайдено груп: ${output.groups.length}`);
    console.log(`Довідник перезаписано: ${absoluteOutputPath}`);
}


const isDirectRun = process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
    testExportAdsPowerGroups().catch((error) => {
        console.error("Не вдалося експортувати групи AdsPower:");
        console.error(error.stack ?? error.message);
        process.exitCode = 1;
    });
}
