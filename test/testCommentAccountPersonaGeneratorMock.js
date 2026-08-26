import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import CommentAccountPersonaGenerator, {
    normalizeCommentAccountPersonas,
} from "../services/personas/CommentAccountPersonaGenerator.js";


function createPersona(gender, firstName) {
    return {
        gender,
        firstName,
        lastName: `${firstName}son`,
        bio: `${firstName} bio`,
        education: `${firstName} school`,
        work: {
            company: `${firstName} GmbH`,
            position: "Mechaniker",
        },
    };
}


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-personas-"));
const countriesFile = path.join(directory, "countries.json");
const systemPromptFile = path.join(directory, "prompt.txt");
await writeFile(countriesFile, JSON.stringify({ DE: "Germany" }), "utf8");
await writeFile(systemPromptFile, "System prompt", "utf8");

try {
    let captured;
    const generator = new CommentAccountPersonaGenerator({
        systemPromptFile,
        grokClient: {
            async generateJson(request) {
                captured = request;
                return {
                    data: {
                        geo: "DE",
                        profiles: [
                            createPersona("male", "Holger"),
                            createPersona("female", "Meike"),
                        ],
                    },
                };
            },
        },
    });

    const result = await generator.generate({
        geo: "поляки",
        maleCount: 1,
        femaleCount: 1,
        excludedNames: ["Jan"],
    });
    assert.equal(result.geo, "поляки");
    assert.equal(result.profiles.length, 2);
    assert.equal(captured.schemaName, "comment_account_personas");
    assert.match(captured.prompt, /Заборонені імена: Jan/);
    assert.match(captured.prompt, /Країна для коментарів: поляки/);

    await assert.rejects(
        () => generator.generate({ geo: "DE", maleCount: 0, femaleCount: 0 }),
        { code: "PERSONA_VALIDATION_ERROR" }
    );
    await assert.rejects(
        () => generator.generate({ geo: "   ", maleCount: 1, femaleCount: 0 }),
        { code: "PERSONA_VALIDATION_ERROR" }
    );

    assert.throws(
        () => normalizeCommentAccountPersonas({
            geo: "DE",
            profiles: [
                createPersona("male", "Holger"),
                createPersona("female", "Jan"),
            ],
        }, {
            geo: "DE",
            maleCount: 1,
            femaleCount: 1,
            excludedNames: ["Jan"],
        }),
        { code: "PERSONA_INVALID_RESPONSE" }
    );
} finally {
    await rm(directory, { recursive: true, force: true });
}

console.log("Mock-перевірка генератора персонажів пройшла успішно");
