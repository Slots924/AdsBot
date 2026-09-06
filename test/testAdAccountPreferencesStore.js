import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdAccountPreferencesStore
    from "../services/gui/AdAccountPreferencesStore.js";


const directory = await mkdtemp(
    path.join(os.tmpdir(), "adsbot-ad-preferences-")
);
const preferencesFile = path.join(directory, "preferences.json");

try {
    const store = new AdAccountPreferencesStore({ preferencesFile });
    const firstClient = await store.enrichAccounts("fp_hub", [
        { id: "act_1", name: "Meta One" },
        { id: "act_2", name: "Meta Two" },
    ]);
    assert.deepEqual(
        firstClient.map(({ localName, isFavorite }) => ({ localName, isFavorite })),
        [
            { localName: "Ім’я 1", isFavorite: false },
            { localName: "Ім’я 2", isFavorite: false },
        ]
    );

    const secondClient = await store.enrichAccounts("backup", [
        { id: "act_2", name: "Same account" },
        { id: "act_3", name: "Meta Three" },
    ]);
    assert.equal(secondClient[0].localName, "Ім’я 2");
    assert.equal(secondClient[1].localName, "Ім’я 3");

    await store.setFavorite("fp_hub", "act_2", true);
    await store.setFavorite("fp_hub", "act_1", true);
    assert.deepEqual(
        await store.reorderFavorites("fp_hub", ["act_1", "act_2"]),
        ["act_1", "act_2"]
    );
    await store.setFavorite("backup", "act_2", true);
    await store.rename("act_2", "Головний РК");

    const restarted = new AdAccountPreferencesStore({ preferencesFile });
    const restoredFirst = await restarted.enrichAccounts("fp_hub", [
        { id: "act_2" },
        { id: "act_1" },
    ]);
    const restoredSecond = await restarted.enrichAccounts("backup", [
        { id: "act_2" },
    ]);
    assert.equal(restoredFirst[0].localName, "Головний РК");
    assert.equal(restoredFirst[1].favoritePosition, 0);
    assert.equal(restoredFirst[0].favoritePosition, 1);
    assert.equal(restoredSecond[0].localName, "Головний РК");
    assert.equal(restoredSecond[0].favoritePosition, 0);

    const firstCampaignOrder = await restarted.enrichCampaigns("act_1", [
        { id: "campaign-2", name: "Second" },
        { id: "campaign-1", name: "First" },
    ]);
    assert.deepEqual(firstCampaignOrder.map((campaign) => campaign.id), [
        "campaign-2",
        "campaign-1",
    ]);
    await restarted.reorderCampaigns("act_1", ["campaign-1", "campaign-2"]);
    const sharedCampaignOrder = await restarted.enrichCampaigns("act_1", [
        { id: "campaign-2", name: "Second" },
        { id: "campaign-3", name: "New" },
        { id: "campaign-1", name: "First" },
    ]);
    assert.deepEqual(sharedCampaignOrder.map((campaign) => campaign.id), [
        "campaign-3",
        "campaign-1",
        "campaign-2",
    ]);

    await assert.rejects(
        restarted.rename("act_2", "  "),
        { code: "AD_ACCOUNT_NAME_REQUIRED" }
    );

    console.log("Перевірка локальних налаштувань РК пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
