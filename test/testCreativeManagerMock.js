import assert from "node:assert/strict";
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import CreativeManager
    from "../services/creatives/CreativeManager.js";


function createValidCreative(text = "Creative text") {
    return {
        creative: text,
        comments: [{
            id: "1",
            parent_id: null,
            text: "Comment text",
            gender: "male",
            profile_key: null,
            is_author: false,
            should_write: true,
        }],
    };
}


const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-creatives-test-")
);
const creativesDirectory = path.join(temporaryDirectory, "creatives");
const originalsDirectory = path.join(creativesDirectory, "originals");
const countriesFile = path.join(temporaryDirectory, "countries.json");
const systemPromptFile = path.join(temporaryDirectory, "system.txt");

await mkdir(originalsDirectory, { recursive: true });
await writeFile(
    countriesFile,
    JSON.stringify({ US: "United States", UA: "Ukraine" }),
    "utf8"
);
await writeFile(systemPromptFile, "System instructions", "utf8");

function createManager(grokClient) {
    return new CreativeManager({
        grokClient,
        countriesFile,
        creativesDirectory,
        originalsDirectory,
        systemPromptFile,
    });
}

try {
    let grokCalls = 0;
    let capturedRequest;
    let generatedCreative = createValidCreative("Generated creative");
    const grokClient = {
        async generateJson(request) {
            grokCalls += 1;
            capturedRequest = request;
            return { data: generatedCreative };
        },
    };
    const creativeManager = createManager(grokClient);
    const cachedCreative = createValidCreative("Cached creative");

    await writeFile(
        path.join(creativesDirectory, "US cached.json"),
        JSON.stringify(cachedCreative),
        "utf8"
    );

    assert.deepEqual(
        await creativeManager.getCreative(" us ", "cached"),
        cachedCreative
    );
    assert.equal(grokCalls, 0);

    await assert.rejects(
        creativeManager.getCreative("XX", "cached"),
        { code: "CREATIVE_COUNTRY_NOT_FOUND" }
    );
    await assert.rejects(
        creativeManager.getCreative("US", "../138"),
        { code: "CREATIVE_VALIDATION_ERROR" }
    );
    await assert.rejects(
        creativeManager.getCreative("USA", "138"),
        { code: "CREATIVE_VALIDATION_ERROR" }
    );
    await assert.rejects(
        creativeManager.getCreative("US", "missing"),
        { code: "CREATIVE_ORIGINAL_NOT_FOUND" }
    );

    await writeFile(
        path.join(originalsDirectory, "new_offer.txt"),
        "Original creative",
        "utf8"
    );
    const createdCreative = await creativeManager.getCreative(
        "US",
        "new_offer"
    );

    assert.deepEqual(createdCreative, generatedCreative);
    assert.equal(grokCalls, 1);
    assert.equal(capturedRequest.systemPrompt, "System instructions");
    assert.equal(
        capturedRequest.prompt,
        "Адаптуй креатив під країну United States (US).\n\nOriginal creative"
    );
    assert.equal(capturedRequest.schemaName, "creative");
    assert.equal(capturedRequest.schema.type, "object");
    assert.equal(capturedRequest.schema.additionalProperties, false);
    assert.deepEqual(
        capturedRequest.schema.required,
        ["creative", "comments"]
    );

    const savedCreative = await readFile(
        path.join(creativesDirectory, "US new_offer.json"),
        "utf8"
    );
    assert.equal(
        savedCreative,
        `${JSON.stringify(generatedCreative, null, 2)}\n`
    );

    generatedCreative = createValidCreative("Recreated creative");
    assert.deepEqual(
        await creativeManager.createCreative("US", "new_offer"),
        generatedCreative
    );
    assert.equal(grokCalls, 2);
    assert.deepEqual(
        JSON.parse(await readFile(
            path.join(creativesDirectory, "US new_offer.json"),
            "utf8"
        )),
        generatedCreative
    );

    await writeFile(
        path.join(creativesDirectory, "US broken.json"),
        "{ broken json",
        "utf8"
    );
    await assert.rejects(
        creativeManager.getCreative("US", "broken"),
        { code: "CREATIVE_INVALID_FILE" }
    );
    assert.equal(grokCalls, 2);

    const previousCreative = createValidCreative("Keep this creative");
    const preserveTarget = path.join(
        creativesDirectory,
        "US preserve.json"
    );
    await writeFile(
        path.join(originalsDirectory, "preserve.txt"),
        "Original to recreate",
        "utf8"
    );
    await writeFile(
        preserveTarget,
        JSON.stringify(previousCreative),
        "utf8"
    );
    const invalidResponseManager = createManager({
        async generateJson() {
            return {
                data: {
                    creative: "Missing comments",
                },
            };
        },
    });

    await assert.rejects(
        invalidResponseManager.createCreative("US", "preserve"),
        { code: "CREATIVE_INVALID_RESPONSE" }
    );
    assert.deepEqual(
        JSON.parse(await readFile(preserveTarget, "utf8")),
        previousCreative
    );

    await writeFile(
        path.join(originalsDirectory, "parallel.txt"),
        "Parallel original",
        "utf8"
    );
    let parallelCalls = 0;
    const parallelCreative = createValidCreative("Parallel result");
    const parallelManager = createManager({
        async generateJson() {
            parallelCalls += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { data: parallelCreative };
        },
    });
    const parallelResults = await Promise.all([
        parallelManager.getCreative("US", "parallel"),
        parallelManager.getCreative("us", "parallel"),
    ]);

    assert.equal(parallelCalls, 1);
    assert.deepEqual(parallelResults, [parallelCreative, parallelCreative]);
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log("Mock-перевірка CreativeManager пройшла успішно");
