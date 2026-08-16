import "dotenv/config";

import AdsPower from "./classes/AdsPower.js";
import runCommentingScenario from "./scenarios/runCommentingScenario.js";


// Налаштування кампанії коментування
const adsPowerGroupId = "8278298";
const commentsFilePath = "./data/comments/HU/4.json";
const postUrl = "https://www.facebook.com/share/p/1DX5dVnBMm/";


async function main() {
    const adsPower = new AdsPower();
    const { report, reportPath } =
        await runCommentingScenario({
            adsPower,
            groupId: adsPowerGroupId,
            commentsFilePath,
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
