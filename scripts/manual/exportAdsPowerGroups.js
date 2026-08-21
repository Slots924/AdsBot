import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";

import AdsPower from "../../classes/AdsPower.js";
import AdsPowerGroupService
    from "../../services/adspower/AdsPowerGroupService.js";


async function testExportAdsPowerGroups() {
    const groupService = new AdsPowerGroupService({
        adsPower: new AdsPower(),
    });
    const groups = await groupService.refreshGroups();

    console.log("Джерело: Profile API V2");
    console.log(`Знайдено груп: ${groups.length}`);
    console.log(`Довідник перезаписано: ${groupService.groupsFile}`);
    console.table(groups);
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
