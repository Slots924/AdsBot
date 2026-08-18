import "dotenv/config";

import AdsPower from "./classes/AdsPower.js";
import runCommentingScenario from "./scenarios/runCommentingScenario.js";


// Налаштування кампанії коментування
const adsPowerGroupIds = ["7398930"];
const commentsFilePath = "./data/comments/CZ/17.json";
const postUrl = "https://www.facebook.com/share/p/191TWjNqt1/";


async function main() {
    const adsPower = new AdsPower();
    const { report, reportPath } =
        await runCommentingScenario({
            adsPower,
            groupIds: adsPowerGroupIds,
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
