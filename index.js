import "dotenv/config";

import AdsPower from "./classes/AdsPower.js";
import runCommentingScenario from "./scenarios/runCommentingScenario.js";
import CreativeManager from "./services/creatives/CreativeManager.js";
import AppLogger from "./services/logging/AppLogger.js";
import { configureRuntimeLogger } from "./services/logging/runtimeLogger.js";


// Налаштування кампанії коментування
const adsPowerGroupIds = ["7398930"];
const geo = "CZ";
const creativeName = "138";
const postUrl = "https://www.facebook.com/share/p/19sbfZi1dd/";
const appLogger = new AppLogger({ logsDirectory: "./data/logs" });


async function main() {
    await appLogger.initialize();
    configureRuntimeLogger(appLogger);
    appLogger.installConsoleBridge("cli");
    const adsPower = new AdsPower();
    const creativeManager = new CreativeManager();
    const creative = await creativeManager.getCreative(
        geo,
        creativeName
    );
    const comments = creative.comments;
    const { report } =
        await runCommentingScenario({
            adsPower,
            groupIds: adsPowerGroupIds,
            comments,
            geo,
            creativeName,
            postUrl,
            logger: appLogger.child("comments"),
        });

    console.log("=== Кампанію завершено ===");
    console.log(`Успішно: ${report.published.length}`);
    console.log(`Пропущено: ${report.skipped.length}`);
    console.log(
        `Не вдалося опублікувати: ${report.failedComments.length}`
    );

    if (report.fatalError || report.failedComments.length > 0) {
        process.exitCode = 1;
    }
    await appLogger.flush();
}


main().catch((error) => {
    appLogger.error("cli.failed", "Непередбачена помилка CLI", { error });
    process.exitCode = 1;
    return appLogger.flush();
});
