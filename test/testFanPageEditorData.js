import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import CommentAccountProfileData from "../services/profiles/CommentAccountProfileData.js";
import { emails, instagramHandles } from "../services/profiles/sharedContacts.js";
import prepareFanPagePhotos from "../services/personalAccounts/prepareFanPagePhotos.js";

assert.equal(emails.length, 200);
assert.equal(new Set(emails).size, 200);
assert.equal(instagramHandles.length, 100);
assert.equal(new Set(instagramHandles).size, 100);
assert.ok(emails.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
assert.ok(instagramHandles.every((handle) => /^@[a-z0-9_.]+$/.test(handle)));

const directory = await mkdtemp(path.join(os.tmpdir(), "adsbot-fanpage-edit-"));
try {
    const namesDirectory = path.join(directory, "names", "man");
    await mkdir(namesDirectory, { recursive: true });
    const namesFile = path.join(namesDirectory, "UK.json");
    const names = JSON.stringify([{ firstName: "Oliver", lastName: "Moss" }]);
    await writeFile(namesFile, names);
    const provider = new CommentAccountProfileData({ dataRoot: directory, grokClient: {
        generateJson() { throw new Error("Локальне заповнення не повинно викликати Grok"); },
    } });
    const profile = await provider.getLocalProfile({ geo: "GB", random: () => 0 });
    assert.equal(profile.firstName, "Oliver");
    assert.equal(profile.email, emails[0]);
    assert.equal(profile.instagram, instagramHandles[0]);
    assert.equal(profile.company, "");
    assert.equal(await readFile(namesFile, "utf8"), names);
    await assert.rejects(provider.getLocalProfile({ geo: "DE" }), { code: "PROFILE_DATA_NOT_FOUND" });

    const png = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(1200, 16);
    png.writeUInt32BE(600, 20);
    const imagePaths = ["1.png", "2.png", "3.png", "4.png"].map((name) => path.join(directory, name));
    for (const file of imagePaths) await writeFile(file, png);
    const plainPlan = await prepareFanPagePhotos({ imagePaths });
    assert.deepEqual(plainPlan.map((step) => step.action), ["avatar", "cover", "clearPosts", "post", "post"]);
    assert.equal(plainPlan[0].imagePath, imagePaths[0]);
    assert.equal(plainPlan[1].imagePath, imagePaths[1]);
    assert.ok(plainPlan.filter((step) => step.action === "post").every((step) => step.date === ""));
    const datedPlan = await prepareFanPagePhotos({ imagePaths, changeDates: true, minimumDate: "2020-01-01" });
    const dates = datedPlan.filter((step) => step.action === "post").map((step) => step.date);
    assert.equal(new Set(dates).size, 2);
    assert.ok(dates.every((date) => date >= "2020-01-01" && date <= new Date().toISOString().slice(0, 10)));
    await assert.rejects(prepareFanPagePhotos({ imagePaths, changeDates: true, minimumDate: "2099-01-01" }));
    await assert.rejects(prepareFanPagePhotos({ imagePaths: [imagePaths[0]] }));
} finally {
    await rm(directory, { recursive: true, force: true });
}
console.log("FanPage editor data tests passed");
