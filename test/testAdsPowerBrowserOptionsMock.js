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

const profileNameAdsPower = new AdsPower();
let profileNameRequest = null;
profileNameAdsPower.request = async (method, url, data) => {
    profileNameRequest = { method, url, data };
    return { data: { code: 0, data: {} } };
};
await profileNameAdsPower.updateProfileName(
    "profile-id-1880",
    "m_Vojtěch Sedláček only changed name"
);
assert.equal(profileNameRequest.method, "post");
assert.match(
    profileNameRequest.url,
    /\/api\/v2\/browser-profile\/update$/
);
assert.deepEqual(profileNameRequest.data, {
    profile_id: "profile-id-1880",
    name: "m_Vojtěch Sedláček only changed name",
});
await assert.rejects(
    () => profileNameAdsPower.updateProfileName("", "Profile name"),
    /profile_id/
);
await assert.rejects(
    () => profileNameAdsPower.updateProfileName("profile-id", ""),
    /не може бути порожньою/
);

const proxyAdsPower = new AdsPower();
let proxyRequest = null;
proxyAdsPower.request = async (method, url, data) => {
    proxyRequest = { method, url, data };
    return { data: { code: 0, data: {} } };
};
await proxyAdsPower.updateProfileProxy("profile-id-1880", {
    proxy_soft: "other",
    proxy_type: "socks5",
    proxy_host: "proxy.example.com",
    proxy_port: "10000",
    proxy_user: "user",
    proxy_password: "secret",
    proxy_url: "https://provider.example/changeip/token",
});
assert.equal(proxyRequest.method, "post");
assert.match(proxyRequest.url, /\/api\/v2\/browser-profile\/update$/);
assert.equal(proxyRequest.data.profile_id, "profile-id-1880");
assert.equal(proxyRequest.data.user_proxy_config.proxy_type, "socks5");
await assert.rejects(
    () => proxyAdsPower.updateProfileProxy("", { proxy_type: "socks5" }),
    /profile_id/
);

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
assert.deepEqual(normalizeState({}).commentWorkerProxyIds, {});
assert.deepEqual(
    normalizeState({
        commentWorkerProxyIds: { 1: "proxy-001", 9: "proxy-009", extra: "nope" },
    }).commentWorkerProxyIds,
    { 1: "proxy-001" }
);
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

const listClient = new AdsPower();
let listRequest = null;
listClient.request = async (method, url, data) => {
    listRequest = { method, url, data };
    return {
        data: {
            code: 0,
            data: {
                list: [
                    { id: "1478605", name: "Change Name Error", color: "red" },
                ],
            },
        },
    };
};
const tags = await listClient.listBrowserTags();
assert.equal(listRequest.method, "post");
assert.match(listRequest.url, /\/api\/v2\/browser-tags\/list$/);
assert.deepEqual(listRequest.data, { page: 1, page_size: 100 });
assert.equal(tags[0].id, "1478605");

console.log("Mock-перевірка режимів браузера AdsPower пройшла успішно");
