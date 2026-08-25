import "dotenv/config";

import AdsPower from "../classes/AdsPower.js";
import runParallelCommentAccountSetupScenario
    from "../scenarios/runParallelCommentAccountSetupScenario.js";
import CommentAccountPersonaGenerator
    from "../services/personas/CommentAccountPersonaGenerator.js";


const PROFILE_NO = 1809;
const GEO = "CZ";
const PHOTOS_DIRECTORY = "C:\\Users\\Darkness\\Desktop\\Work\\Photo\\CZ";


async function runTest() {
    console.log("=== Оформлення акаунта під коментарі ===");
    console.log(`Профіль AdsPower: ${PROFILE_NO}`);
    console.log(`Гео: ${GEO}`);
    console.log("Стать: 1 чоловічий");
    console.log("Пропускаємо зміну імені, решту робимо");
    console.log(`Фото: ${PHOTOS_DIRECTORY}`);

    console.log("\n1. Grok генерує дані персонажа...");
    const generator = new CommentAccountPersonaGenerator();
    const personas = await generator.generate({
        geo: GEO,
        maleCount: 1,
        femaleCount: 0,
        excludedNames: [],
    });
    console.log("Персонаж:", JSON.stringify(personas.profiles[0], null, 2));

    console.log("\n2. Запускаємо сценарій...");
    const adsPower = new AdsPower();
    const { report } = await runParallelCommentAccountSetupScenario({
        adsPower,
        profileNos: [PROFILE_NO],
        personas: personas.profiles,
        geo: GEO,
        photosDirectory: PHOTOS_DIRECTORY,
        concurrency: 1,
        skipNameChange: true,
        ignoreSkipReasons: true,
        logger: console,
        onProgress: (event) => {
            if (event.message) {
                console.log(`[PROGRESS] ${event.message}`);
            }
        },
    });

    console.log("\n=== ГОТОВО ===");
    console.log(`Результат: ${report.profiles[0]?.outcome ?? "немає"}`);
    console.log(`Звіт: ${report.reportPath}`);

    if (report.fatalError || report.profiles[0]?.outcome !== "success") {
        process.exitCode = 1;
    }
}


process.on("uncaughtException", (error) => {
    console.error("UNCAUGHT EXCEPTION:", error.stack || error);
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
    process.exit(1);
});

await runTest();
