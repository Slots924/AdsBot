import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AppStateStore from "../services/gui/AppStateStore.js";
import CampaignTemplateManager
    from "../services/templates/CampaignTemplateManager.js";


const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-templates-")
);

try {
    const templatesFile = path.join(temporaryDirectory, "templates.json");
    const manager = new CampaignTemplateManager({ templatesFile });

    assert.deepEqual(await manager.list(), []);
    const first = await manager.create({ name: "AT Slot", pixel: "pixel-1" });
    const copy = await manager.duplicate(first.id);
    assert.equal(first.id, 1);
    assert.equal(copy.id, 2);
    assert.equal(copy.name, first.name);
    assert.deepEqual(first.countryCodes, []);
    assert.deepEqual(first.placements, {
        facebook: ["feed"],
        instagram: [],
    });
    assert.equal(first.gender, "any");
    assert.equal(first.ageMin, 18);
    assert.equal(first.ageMax, 65);
    assert.equal(first.dsaBeneficiary, "");
    assert.equal(first.dsaPayorSameAsBeneficiary, true);
    assert.equal(first.dsaPayor, "");

    const updated = await manager.update(copy.id, {
        name: "AT Slot updated",
        pixel: "pixel-2",
    });
    assert.equal(updated.pixel, "pixel-2");
    await manager.delete(first.id);
    assert.deepEqual((await manager.list()).map((item) => item.id), [2]);

    const third = await manager.create({ name: "AT Slot updated" });
    assert.equal(third.id, 3);
    await assert.rejects(
        manager.create({ name: "  " }),
        { code: "TEMPLATE_NAME_REQUIRED" }
    );

    const saved = JSON.parse(await readFile(templatesFile, "utf8"));
    assert.equal(saved.nextId, 4);
    assert.equal(saved.templates.length, 2);
    assert.equal(saved.version, 3);

    const legacyFile = path.join(temporaryDirectory, "legacy.json");
    await writeFile(legacyFile, JSON.stringify({
        version: 1,
        nextId: 2,
        templates: [{ id: 1, name: "Legacy", pixel: "100" }],
    }));
    const legacyManager = new CampaignTemplateManager({
        templatesFile: legacyFile,
    });
    const [legacy] = await legacyManager.list();
    assert.equal(legacy.schemaVersion, 3);
    assert.deepEqual(legacy.placements.facebook, ["feed"]);
    assert.equal(legacy.dsaBeneficiary, "");
    assert.equal(legacy.dsaPayorSameAsBeneficiary, true);
    assert.equal(legacy.dsaPayor, "");
    assert.equal(JSON.parse(await readFile(legacyFile, "utf8")).version, 3);

    const dsaTemplate = await manager.create({
        name: "EU Leads",
        dsaBeneficiary: "Example Beneficiary LLC",
        dsaPayorSameAsBeneficiary: false,
        dsaPayor: "Example Payor LLC",
    });
    assert.equal(dsaTemplate.dsaBeneficiary, "Example Beneficiary LLC");
    assert.equal(dsaTemplate.dsaPayorSameAsBeneficiary, false);
    assert.equal(dsaTemplate.dsaPayor, "Example Payor LLC");

    const stateFile = path.join(temporaryDirectory, "app-state.json");
    const stateStore = new AppStateStore({ stateFile });
    await stateStore.save({
        activeTab: "templates",
        uiScale: 1.4,
        selectedAccountKey: "account-1",
        publishForm: { geo: "hu", secret: "not-saved" },
        commentsForm: { postUrl: "https://facebook.com/post" },
        createCampaignsPaused: false,
        unsafe: "not-saved",
    });
    const state = await stateStore.load();
    assert.equal(state.activeTab, "templates");
    assert.equal(state.uiScale, 1.4);
    assert.equal(state.publishForm.geo, "hu");
    assert.equal(state.createCampaignsPaused, false);
    assert(!("secret" in state.publishForm));
    assert(!("unsafe" in state));

    const defaultStateFile = path.join(temporaryDirectory, "new-state.json");
    assert.equal(
        (await new AppStateStore({ stateFile: defaultStateFile }).load()).uiScale,
        1.3
    );

    console.log("Перевірка шаблонів і стану програми пройшла успішно");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
