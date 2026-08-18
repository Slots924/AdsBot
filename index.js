import "dotenv/config";

import AdsPower from "./classes/AdsPower.js";
import runCommentingScenario from "./scenarios/runCommentingScenario.js";
import CreativeManager from "./services/creatives/CreativeManager.js";


// Налаштування кампанії коментування
const adsPowerGroupIds = ["7398930"];
const geo = "CZ";
const creativeName = "138";
const postUrl = "https://www.facebook.com/share/p/19sbfZi1dd/";


async function main() {
    const adsPower = new AdsPower();
    const creativeManager = new CreativeManager();
    const creative = await creativeManager.getCreative(
        geo,
        creativeName
    );
    const comments = creative.comments;
    const { report, reportPath } =
        await runCommentingScenario({
            adsPower,
            groupIds: adsPowerGroupIds,
            comments,
            geo,
            creativeName,
            postUrl,
        });

    console.log("=== Кампанію завершено ===");
    console.log(`Успішно: ${report.published.length}`);
    console.log(`Пропущено: ${report.skipped.length}`);
    console.log(
        `Не вдалося опублікувати: ${report.failedComments.length}`
    );
    console.log(`Звіт: ${reportPath ?? "не збережено"}`);

    if (report.fatalError || report.failedComments.length > 0) {
        process.exitCode = 1;
    }
}


main().catch((error) => {
    console.error("Непередбачена помилка:", error.message);
    process.exitCode = 1;
});
