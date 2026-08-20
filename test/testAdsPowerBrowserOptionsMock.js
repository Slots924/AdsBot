import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdsPower from "../classes/AdsPower.js";
import AppStateStore, { normalizeState } from "../services/gui/AppStateStore.js";


const cases = [
    {
        options: { browserMode: "visible", disableImages: false },
        expected: { headless: "0" },
    },
    {
        options: { browserMode: "headless", disableImages: false },
        expected: { headless: "1" },
    },
    {
        options: { browserMode: "visible", disableImages: true },
        expected: {
            headless: "0",
            launch_args: ["--blink-settings=imagesEnabled=false"],
        },
    },
    {
        options: { browserMode: "headless", disableImages: true },
        expected: {
            headless: "1",
            launch_args: ["--blink-settings=imagesEnabled=false"],
        },
    },
];

for (const testCase of cases) {
    const adsPower = new AdsPower({ apiUrl: "http://127.0.0.1:50325" });
    let request = null;
    adsPower.request = async (method, url, data) => {
        request = { method, url, data };
        return {
            data: {
                code: 0,
                data: { ws: { puppeteer: "ws://test" } },
            },
        };
    };

    await adsPower.openProfile("42", testCase.options);
    assert.equal(request.method, "post");
    assert.deepEqual(request.data, {
        profile_no: "42",
        last_opened_tabs: "0",
        proxy_detection: "0",
        ...testCase.expected,
    });
}

const legacyAdsPower = new AdsPower({ apiUrl: "http://127.0.0.1:50325" });
let legacyPayload = null;
legacyAdsPower.request = async (_method, _url, data) => {
    legacyPayload = data;
    return { data: { code: 0, data: {} } };
};
await legacyAdsPower.openProfile("7");
assert.equal("headless" in legacyPayload, false);
assert.equal("launch_args" in legacyPayload, false);

assert.deepEqual(
    {
        mode: normalizeState({}).commentBrowserMode,
        images: normalizeState({}).commentDisableImages,
    },
    { mode: "visible", images: false }
);
assert.equal(normalizeState({ commentBrowserMode: "headless" }).commentBrowserMode, "headless");
assert.equal(normalizeState({ commentBrowserMode: "broken" }).commentBrowserMode, "visible");
assert.equal(normalizeState({ commentDisableImages: true }).commentDisableImages, true);
assert.equal(normalizeState({ commentDisableImages: "true" }).commentDisableImages, false);
assert.equal(normalizeState({}).logLevel, "info");
assert.equal(normalizeState({ logLevel: "debug" }).logLevel, "debug");
assert.equal(normalizeState({ logLevel: "trace" }).logLevel, "info");

const stateDirectory = await mkdtemp(path.join(os.tmpdir(), "adsbot-browser-settings-"));
try {
    const stateFile = path.join(stateDirectory, "app-state.json");
    const firstStore = new AppStateStore({ stateFile });
    await firstStore.save({
        commentBrowserMode: "headless",
        commentDisableImages: true,
    });
    const restored = await new AppStateStore({ stateFile }).load();
    assert.equal(restored.commentBrowserMode, "headless");
    assert.equal(restored.commentDisableImages, true);
} finally {
    await rm(stateDirectory, { recursive: true, force: true });
}

console.log("Mock-перевірка режимів браузера AdsPower пройшла успішно");
