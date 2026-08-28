import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import KeitaroStreamTemplateManager from "../services/keitaro/KeitaroStreamTemplateManager.js";


const directory = await mkdtemp(path.join(os.tmpdir(), "keitaro-streams-"));
const templatesFile = path.join(directory, "templates.json");
const manager = new KeitaroStreamTemplateManager({ templatesFile });

const seeded = await manager.list();
assert.equal(seeded.length, 1);
assert.equal(seeded[0].sourceStreamId, 423);
assert.equal(seeded[0].stream.name, "White");
assert.equal(seeded[0].stream.filters.length, 4);
assert.equal(seeded[0].stream.landings[0].landing_id, 68);

const created = await manager.create({
    name: "Test stream",
    stream: { name: "Test", filters: [{ name: "bot", mode: "accept" }] },
});
assert.equal(created.name, "Test stream");

const updated = await manager.update(created.id, {
    name: "Test stream 2",
    stream: { name: "Test 2", schema: "action", action_options: { code: 302 } },
});
assert.equal(updated.stream.schema, "action");
assert.deepEqual(updated.stream.action_options, { code: 302 });

const copy = await manager.duplicate(seeded[0].id);
assert.match(copy.name, /копія/);
assert.equal(copy.stream.landings[0].name, "White [JP]");

await manager.delete(created.id);
const left = await manager.list();
assert.equal(left.some((item) => item.id === created.id), false);

await rm(directory, { recursive: true, force: true });
console.log("Перевірка шаблонів потоків Keitaro пройшла успішно");
