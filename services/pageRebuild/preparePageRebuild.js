import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import loadImageFromPath from "../images/loadImageFromPath.js";
import readImageDimensions from "../images/readImageDimensions.js";


function createPreparationError(message, code = "PAGE_REBUILD_FOLDER_INVALID") {
    const error = new Error(message);
    error.code = code;
    return error;
}


const compareNames = (left, right) => left.filename.localeCompare(
    right.filename,
    "uk-UA",
    { numeric: true, sensitivity: "base" }
);


function roleMarker(filename, marker) {
    const stem = path.basename(filename, path.extname(filename));
    return new RegExp(`^${marker}(?:$|[ _.-])`).test(stem);
}


function isAvatarCandidate(image) {
    if (!image.dimensions) return false;
    const ratio = image.dimensions.width / image.dimensions.height;
    return image.dimensions.width >= 320
        && image.dimensions.height >= 320
        && ratio >= 0.8
        && ratio <= 1.25;
}


function isCoverCandidate(image) {
    if (!image.dimensions) return false;
    const ratio = image.dimensions.width / image.dimensions.height;
    return image.dimensions.width >= 820
        && image.dimensions.height >= 312
        && ratio >= 2.2
        && ratio <= 3;
}


function chooseRolePair(images, random) {
    const avatars = images.filter(isAvatarCandidate);
    const covers = images.filter(isCoverCandidate);
    const pairs = avatars.flatMap((avatar) => covers
        .filter((cover) => cover.absolutePath !== avatar.absolutePath)
        .map((cover) => ({
            avatar,
            cover,
            score: Number(roleMarker(avatar.filename, 1))
                + Number(roleMarker(cover.filename, 2)),
        })));
    if (!pairs.length) {
        throw createPreparationError(
            "У папці немає окремих придатних фотографій для avatar і cover",
            "PAGE_REBUILD_ROLE_IMAGES_MISSING"
        );
    }
    const bestScore = Math.max(...pairs.map((pair) => pair.score));
    const bestPairs = pairs.filter((pair) => pair.score === bestScore);
    return bestPairs[Math.floor(random() * bestPairs.length)];
}


/** Перевіряє папку і формує незмінний план використання її зображень. */
export default async function preparePageRebuild({
    imagesDirectory,
    imageLoader = loadImageFromPath,
    random = Math.random,
} = {}) {
    const directory = path.resolve(String(imagesDirectory ?? "").trim());
    if (!String(imagesDirectory ?? "").trim()) {
        throw createPreparationError("Не вказано папку із фотографіями");
    }

    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        throw createPreparationError("Не вдалося прочитати папку із фотографіями");
    }

    const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
    const files = entries
        .filter((entry) => entry.isFile())
        .filter((entry) => supportedExtensions.has(
            path.extname(entry.name).toLowerCase()
        ))
        .map((entry) => path.join(directory, entry.name));
    if (files.length < 3) {
        throw createPreparationError(
            "У папці має бути щонайменше три зображення: avatar, cover і один пост",
            "PAGE_REBUILD_IMAGES_MISSING"
        );
    }

    const images = [];
    for (const file of files) {
        const loaded = await imageLoader(file);
        let dimensions = null;
        if (["image/jpeg", "image/png"].includes(loaded.contentType)) {
            dimensions = readImageDimensions(loaded.buffer, loaded.contentType);
        }
        images.push({
            absolutePath: path.resolve(file),
            filename: loaded.filename,
            contentType: loaded.contentType,
            size: loaded.buffer.length,
            dimensions,
            digest: createHash("sha256").update(loaded.buffer).digest("hex"),
        });
    }
    images.sort(compareNames);

    const { avatar, cover } = chooseRolePair(images, random);
    const posts = images.filter((image) => (
        image.absolutePath !== avatar.absolutePath
        && image.absolutePath !== cover.absolutePath
    ));
    if (!posts.length) {
        throw createPreparationError(
            "Після вибору avatar і cover не залишилося фотографій для постів",
            "PAGE_REBUILD_POST_IMAGES_MISSING"
        );
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(
        images.map(({ filename, size, digest }) => ({ filename, size, digest }))
    )).digest("hex");

    const safeImage = ({ digest: _digest, ...image }) => image;
    return {
        imagesDirectory: directory,
        fingerprint,
        avatar: safeImage(avatar),
        cover: safeImage(cover),
        posts: posts.map(safeImage),
    };
}
