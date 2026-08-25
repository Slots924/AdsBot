import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    buildClaimedPhotoSetName,
    classifyPhotoFiles,
    isClaimedPhotoSetName,
    getProfilePhotoRejectReason,
    isUsableProfilePhoto,
    listAvailablePhotoSets,
    takeNextPhotoSet,
} from "../services/accounts/photoSets.js";


assert.equal(isClaimedPhotoSetName("AdsPower_123"), true);
assert.equal(isClaimedPhotoSetName("temp-AdsPower-hold"), true);
assert.equal(isClaimedPhotoSetName("set-1"), false);
assert.equal(buildClaimedPhotoSetName(77), "AdsPower_77");

const classified = classifyPhotoFiles([
    "C:/photos/2.png",
    "C:/photos/notes.txt",
    "C:/photos/3.jpg",
    "C:/photos/1.webp",
]);
assert.equal(classified.avatarCandidate, "C:/photos/1.webp");
assert.equal(classified.coverCandidate, "C:/photos/2.png");
assert.deepEqual(classified.rest, ["C:/photos/3.jpg"]);

const root = await mkdtemp(path.join(os.tmpdir(), "adsbot-photos-"));
try {
    const manSet = path.join(root, "Man", "pack-a");
    const usedSet = path.join(root, "Man", "AdsPower_9");
    const womanSet = path.join(root, "Woman", "pack-b");
    await mkdir(manSet, { recursive: true });
    await mkdir(usedSet, { recursive: true });
    await mkdir(womanSet, { recursive: true });
    await writeFile(path.join(manSet, "1.jpg"), "x");
    await writeFile(path.join(manSet, "2.jpg"), "x");
    await writeFile(path.join(womanSet, "3.jpg"), "x");

    const maleSets = await listAvailablePhotoSets(root, "male");
    assert.equal(maleSets.length, 1);
    assert.equal(maleSets[0].name, "pack-a");

    const taken = await takeNextPhotoSet(root, "male", 42);
    assert.equal(taken.name, "AdsPower_42");
    assert.equal(taken.files.length, 2);
    assert.equal(path.basename(taken.path), "AdsPower_42");
    assert.equal((await listAvailablePhotoSets(root, "male")).length, 0);

    const again = await takeNextPhotoSet(root, "male", 42);
    assert.equal(again.path, taken.path);
    assert.equal(await takeNextPhotoSet(root, "male", 99), null);

    const fakePng = (width, height) => {
        const buffer = Buffer.alloc(24);
        buffer[0] = 0x89;
        buffer.write("PNG", 1);
        buffer.writeUInt32BE(width, 16);
        buffer.writeUInt32BE(height, 20);
        return buffer;
    };
    const okAvatar = path.join(root, "avatar.png");
    const tinyCover = path.join(root, "tiny.png");
    const okCover = path.join(root, "cover.png");
    const badTxt = path.join(root, "bad.txt");
    const emptyJpg = path.join(root, "empty.jpg");
    await writeFile(okAvatar, fakePng(320, 320));
    await writeFile(tinyCover, fakePng(100, 100));
    await writeFile(okCover, fakePng(851, 315));
    await writeFile(badTxt, "hello");
    await writeFile(emptyJpg, "");
    assert.equal(await isUsableProfilePhoto(okAvatar, "avatar"), true);
    assert.equal(await isUsableProfilePhoto(tinyCover, "avatar"), false);
    assert.match(
        await getProfilePhotoRejectReason(tinyCover, "cover"),
        /розмір/
    );
    assert.equal(await isUsableProfilePhoto(okCover, "cover"), true);
    assert.equal(await isUsableProfilePhoto(badTxt, "avatar"), false);
    assert.equal(await isUsableProfilePhoto(emptyJpg, "avatar"), false);
} finally {
    await rm(root, { recursive: true, force: true });
}

console.log("Перевірка папок фото для акаунтів пройшла успішно");
