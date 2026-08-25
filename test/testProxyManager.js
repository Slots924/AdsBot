import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ProxyManager from "../services/proxy/ProxyManager.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-proxies-"));

try {
    const proxiesFile = path.join(directory, "proxies.json");
    await writeFile(proxiesFile, `${JSON.stringify({
        proxies: [{
            id: "proxy-001",
            type: "socks5",
            host: "proxy.example.com",
            port: "10000",
            username: "old-user",
            password: "old-pass",
        }],
    }, null, 2)}\n`, "utf8");
    const manager = new ProxyManager({ proxiesFile });

    const listed = await manager.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, "proxy-001");
    assert.equal(listed[0].adsPowerId, null);
    assert.equal(listed[0].name, "");
    assert.equal(listed[0].hasUsername, true);
    assert.equal(listed[0].hasPassword, true);
    assert.equal(listed[0].hasRefreshUrl, false);
    assert(!("username" in listed[0]));
    assert(!("password" in listed[0]));
    assert(!("refreshUrl" in listed[0]));

    const created = await manager.create({
        adsPowerId: "14",
        name: "Київ",
        type: "http",
        host: "new.example.com",
        port: 20000,
        username: "user",
        password: "secret",
        refreshUrl: "https://provider.example/changeip/token",
    });
    assert.equal(created.id, "proxy-002");
    assert.equal(created.adsPowerId, 14);
    assert.equal(created.name, "Київ");
    assert.equal(created.hasRefreshUrl, true);
    assert(!("password" in created));

    await manager.create({
        adsPowerId: 14,
        name: "Київ",
        type: "socks5",
        host: "second.example.com",
        port: "30000",
    });
    const afterCreate = await manager.list();
    assert.equal(afterCreate.length, 3);
    assert.equal(afterCreate[2].id, "proxy-003");
    assert.equal(afterCreate[1].name, afterCreate[2].name);

    await manager.update("proxy-001", {
        adsPowerId: 9,
        name: "Одеса",
        type: "https",
        host: "updated.example.com",
        port: "11000",
        username: "new-user",
        password: "new-pass",
        refreshUrl: "https://provider.example/changeip/token",
    });
    const persisted = JSON.parse(await readFile(proxiesFile, "utf8")).proxies;
    const first = persisted.find((item) => item.id === "proxy-001");
    assert.equal(first.adsPowerId, 9);
    assert.equal(first.name, "Одеса");
    assert.equal(first.type, "https");
    assert.equal(first.host, "updated.example.com");
    assert.equal(first.port, "11000");
    assert.equal(first.username, "new-user");
    assert.equal(first.password, "new-pass");
    assert.equal(first.refreshUrl, "https://provider.example/changeip/token");
    const loaded = await manager.getById("proxy-001");
    assert.equal(loaded.username, "new-user");
    assert.equal(loaded.password, "new-pass");
    assert.equal(Object.keys(first)[1], "adsPowerId");
    assert.equal(Object.keys(first).at(-1), "refreshUrl");

    const withoutProxy = await manager.create({
        type: "no_proxy",
        name: "Локальна",
    });
    assert.equal(withoutProxy.type, "no_proxy");
    assert.equal(withoutProxy.host, "");

    await assert.rejects(manager.create({
        type: "ftp",
        host: "x.example.com",
        port: "1",
    }), { code: "PROXY_TYPE_INVALID" });
    await assert.rejects(manager.create({
        adsPowerId: "abc",
        type: "http",
        host: "x.example.com",
        port: "1",
    }), { code: "PROXY_ADSPOWER_ID_INVALID" });
    await assert.rejects(manager.update("missing", {
        type: "http",
        host: "x.example.com",
        port: "1",
    }), { code: "PROXY_NOT_FOUND" });

    const reordered = await manager.reorder(["proxy-003", "proxy-001", "proxy-002", "proxy-004"]);
    assert.deepEqual(reordered.map((item) => item.id), [
        "proxy-003",
        "proxy-001",
        "proxy-002",
        "proxy-004",
    ]);
    assert.deepEqual(
        JSON.parse(await readFile(proxiesFile, "utf8")).proxies.map((item) => item.id),
        ["proxy-003", "proxy-001", "proxy-002", "proxy-004"]
    );
    await assert.rejects(manager.reorder(["proxy-001"]), { code: "PROXY_ORDER_INVALID" });

    const removed = await manager.remove("proxy-002");
    assert.equal(removed.id, "proxy-002");
    assert.equal((await manager.list()).length, 3);
    assert.equal(
        JSON.parse(await readFile(proxiesFile, "utf8")).proxies.length,
        3
    );

    console.log("Перевірка менеджера проксі пройшла успішно");
} finally {
    await rm(directory, { recursive: true, force: true });
}
