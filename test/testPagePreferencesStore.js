import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import PagePreferencesStore from "../services/gui/PagePreferencesStore.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-page-preferences-"));
try {
    const preferencesFile = path.join(directory, "preferences.json");
    const store = new PagePreferencesStore({ preferencesFile });
    await store.setFavorite("100", true);
    await store.updateMetadata("100", { geo: "hu", creativeName: "Creo_138V2" });

    const acrossAnotherClient = await store.enrich([
        { id: "100", name: "Page through another API client" },
        { id: "200", name: "Other" },
    ]);
    assert.deepEqual(acrossAnotherClient[0], {
        id: "100",
        name: "Page through another API client",
        geo: "HU",
        creativeName: "138V2",
        isFavorite: true,
    });
    assert.equal(acrossAnotherClient[1].isFavorite, false);

    const restored = new PagePreferencesStore({ preferencesFile });
    assert.equal((await restored.enrich([{ id: "100" }]))[0].isFavorite, true);
    await restored.setFavorite("100", false);
    const afterRemoval = (await restored.enrich([{ id: "100" }]))[0];
    assert.equal(afterRemoval.isFavorite, false);
    assert.equal(afterRemoval.geo, "HU");
    assert.equal(afterRemoval.creativeName, "138V2");
    await assert.rejects(restored.updateMetadata("100", { geo: "HUN" }), { code: "PAGE_GEO_INVALID" });

    console.log("Mock-перевірка глобальних уподобань фанпейдж пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
