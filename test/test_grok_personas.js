import "dotenv/config";

import CommentAccountPersonaGenerator
    from "../services/personas/CommentAccountPersonaGenerator.js";


const GEO = "українці";
const MALE_COUNT = 10;


function printPersona(persona, index) {
    const name = `${persona.firstName} ${persona.lastName}`;
    console.log(`\n${index}. ${name}`);
    console.log(`    Біо:       ${persona.bio}`);
    console.log(`    Компанія:  ${persona.work?.company ?? "—"}`);
    console.log(`    Посада:    ${persona.work?.position ?? "—"}`);
    console.log(`    Універ:    ${persona.education ?? "—"}`);
}


async function runTest() {
    console.log("=== Grok: 10 чоловічих українських профілів ===");
    console.log(`Країна: ${GEO}`);

    const generator = new CommentAccountPersonaGenerator();
    const result = await generator.generate({
        geo: GEO,
        maleCount: MALE_COUNT,
        femaleCount: 0,
        excludedNames: [],
    });

    console.log(`Отримано: ${result.profiles.length}`);
    result.profiles.forEach((persona, index) => {
        printPersona(persona, index + 1);
    });
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
