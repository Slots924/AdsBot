import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MyrahaMonster from "../../../classes/MyrahaMonster.js";

let directory;
let options;
let client;
const item = (enabled = false) => ({ id: "1", enabled, integrationReady: true });
const list = (enabled = false) => ({ status: 200, data: { items: [item(enabled)], page: 1, pageSize: 10, total: 1 } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-myraha-cache-"));
    options = {
        settingsFile: path.join(directory, "settings.json"),
        cacheFile: path.join(directory, "pages.json"),
        encrypt: (value) => value, decrypt: (value) => value,
        httpRequest: vi.fn().mockResolvedValue(list()),
    };
    client = new MyrahaMonster(options);
    await client.saveSettings({ apiKey: "test-only-key" });
});

afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it("зберігає підтверджені положення на диску та відновлює обидва стани після перезапуску", async () => {
    await client.getPages();
    for (const enabled of [true, false]) {
        options.httpRequest.mockResolvedValueOnce({ status: 200, data: { id: "1", enabled } });
        await client.setModeration("1", enabled);
        const restarted = new MyrahaMonster(options);
        expect((await restarted.getCachedPages()).items).toEqual([item(enabled)]);
    }
    expect(options.httpRequest).toHaveBeenCalledTimes(3);
    const disk = await readFile(options.cacheFile, "utf8");
    expect(disk).not.toContain("test-only-key");
});

it("оновлює кеш при перевірці сторінки та очищає його при зміні інтеграції", async () => {
    options.httpRequest.mockResolvedValueOnce({ status: 200, data: item(true) });
    await client.getPage("1");
    expect((await new MyrahaMonster(options).getCachedPages()).items).toEqual([item(true)]);
    await client.saveSettings({ removeApiKey: true });
    expect((await new MyrahaMonster(options).getCachedPages()).items).toBeNull();
});

it("відсутній або пошкоджений кеш не вигадує вимкнений стан", async () => {
    await rm(options.cacheFile);
    expect((await client.getCachedPages()).items).toBeNull();
    await writeFile(options.cacheFile, "{");
    expect((await client.getCachedPages()).items).toBeNull();
});

it("запізнілий список не перезаписує підтверджене перемикання в кеші", async () => {
    await client.getPages();
    const pending = deferred();
    options.httpRequest.mockReturnValueOnce(pending.promise);
    const loading = client.getPages();
    await vi.waitFor(() => expect(options.httpRequest).toHaveBeenCalledTimes(2));
    options.httpRequest.mockResolvedValueOnce({ status: 200, data: { id: "1", enabled: true } });
    await client.setModeration("1", true);
    pending.resolve(list(false));
    await loading;
    expect((await new MyrahaMonster(options).getCachedPages()).items).toEqual([item(true)]);
});

it("список, отриманий під час перемикання, не блокує збереження його результату", async () => {
    await client.getPages();
    const pending = deferred();
    options.httpRequest.mockReturnValueOnce(pending.promise);
    const switching = client.setModeration("1", true);
    await vi.waitFor(() => expect(options.httpRequest).toHaveBeenCalledTimes(2));
    options.httpRequest.mockResolvedValueOnce(list(false));
    await client.getPages();
    pending.resolve({ status: 200, data: { id: "1", enabled: true } });
    await switching;
    expect((await new MyrahaMonster(options).getCachedPages()).items).toEqual([item(true)]);
});
