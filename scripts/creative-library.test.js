import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import CreativeManager from "../services/creatives/CreativeManager.js";
import AppStateStore from "../services/gui/AppStateStore.js";

test("Бібліотека креативів: країни, збереження, валідація та читання без генерації", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-creatives-"));
    try {
        const countriesFile = path.join(directory, "countries.json");
        const appState = new AppStateStore({ stateFile: path.join(directory, "app-state.json") });
        await appState.save({ activeTab: "creatives" });
        assert.equal((await appState.load()).activeTab, "creatives");
        const creativesDirectory = path.join(directory, "creatives");
        await writeFile(countriesFile, JSON.stringify({ UA: "Ukraine", US: "United States" }));
        const manager = new CreativeManager({ countriesFile, creativesDirectory,
            grokClient: { generateJson: () => { throw new Error("Генерація не повинна викликатися"); } } });
        assert.deepEqual(await manager.list(), []);
        await manager.saveOriginal({ name: "202", text: "Довгий оригінал", create: true });
        await assert.rejects(manager.saveOriginal({ name: "202", text: "Інший", create: true }), { code: "CREATIVE_ALREADY_EXISTS" });
        await manager.saveOriginal({ name: "202", text: "Новий" });
        assert.equal((await manager.readOriginal("202")).text, "Новий");
        assert.equal(await readFile(path.join(creativesDirectory, "originals", "202.txt"), "utf8"), "Новий");
        const creative = { creative: "Версія UA", comments: [] };
        await manager.saveVariant({ geo: "ua", name: "202", creative });
        await manager.saveVariant({ geo: "US", name: "17", creative });
        assert.deepEqual(await manager.list(), [
            { name: "17", hasOriginal: false, countries: ["US"] },
            { name: "202", hasOriginal: true, countries: ["UA"] },
        ]);
        assert.deepEqual(await manager.readVariant("UA", "202"), creative);
        await assert.rejects(manager.readVariant("US", "202"), { code: "CREATIVE_NOT_FOUND" });
        await assert.rejects(manager.saveOriginal({ name: "../escape", text: "x", create: true }), { code: "CREATIVE_VALIDATION_ERROR" });
        await assert.rejects(manager.saveVariant({ geo: "UA", name: "202", creative: { creative: "bad", comments: [{}] } }), { code: "CREATIVE_VALIDATION_ERROR" });
        assert.deepEqual(await manager.readVariant("UA", "202"), creative);
        await assert.rejects(manager.saveOriginal({ name: "new", text: "  ", create: true }), { code: "CREATIVE_VALIDATION_ERROR" });
    } finally { await rm(directory, { recursive: true, force: true }); }
});
