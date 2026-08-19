import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

    const stateFile = path.join(temporaryDirectory, "app-state.json");
    const stateStore = new AppStateStore({ stateFile });
    await stateStore.save({
        activeTab: "templates",
        selectedAccountKey: "account-1",
        publishForm: { geo: "hu", secret: "not-saved" },
        commentsForm: { postUrl: "https://facebook.com/post" },
        unsafe: "not-saved",
    });
    const state = await stateStore.load();
    assert.equal(state.activeTab, "templates");
    assert.equal(state.publishForm.geo, "hu");
    assert(!("secret" in state.publishForm));
    assert(!("unsafe" in state));

    console.log("Перевірка шаблонів і стану програми пройшла успішно");
} finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
}
