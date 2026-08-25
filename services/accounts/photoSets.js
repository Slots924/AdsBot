import { readdir, rename, stat } from "node:fs/promises";
import path from "node:path";

import loadImageFromPath from "../images/loadImageFromPath.js";
import readImageDimensions from "../images/readImageDimensions.js";


const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const genderFolders = Object.freeze({
    male: "Man",
    female: "Woman",
});


export function isClaimedPhotoSetName(name) {
    return /adspower/i.test(String(name ?? "").trim());
}


export function buildClaimedPhotoSetName(profileNo) {
    const normalizedProfileNo = String(profileNo ?? "").trim();

    if (!normalizedProfileNo) {
        throw new Error("Не вказано номер AdsPower-профілю для папки фото");
    }

    return `AdsPower_${normalizedProfileNo}`;
}


export function isSupportedPhotoFile(filePath) {
    return imageExtensions.has(
        path.extname(String(filePath ?? "")).toLowerCase()
    );
}


export const facebookProfilePhotoLimits = Object.freeze({
    avatar: {
        minWidth: 180,
        minHeight: 180,
        maxBytes: 8 * 1024 * 1024,
    },
    cover: {
        minWidth: 400,
        minHeight: 150,
        maxBytes: 8 * 1024 * 1024,
    },
});


export async function getProfilePhotoRejectReason(filePath, role = "avatar") {
    const limits = facebookProfilePhotoLimits[role]
        ?? facebookProfilePhotoLimits.avatar;

    try {
        const image = await loadImageFromPath(filePath);
        if (image.buffer.length > limits.maxBytes) {
            return `файл більший за ${Math.round(limits.maxBytes / (1024 * 1024))} МБ`;
        }

        const size = readImageDimensions(image.buffer, image.contentType);
        if (!size) {
            return "не вдалося прочитати розмір картинки";
        }
        if (size.width < limits.minWidth || size.height < limits.minHeight) {
            return `розмір ${size.width}×${size.height}, треба щонайменше ${
                limits.minWidth
            }×${limits.minHeight}`;
        }

        return null;
    } catch {
        return "непідходящий тип файлу (потрібні JPG, JPEG, PNG, WEBP)";
    }
}


export async function isUsableProfilePhoto(filePath, role = "avatar") {
    return (await getProfilePhotoRejectReason(filePath, role)) === null;
}


export function classifyPhotoFiles(filePaths) {
    const images = [...filePaths]
        .filter(isSupportedPhotoFile)
        .sort((left, right) => path.basename(left)
            .localeCompare(path.basename(right), "en", { sensitivity: "base" }));
    let avatarCandidate = null;
    let coverCandidate = null;
    const rest = [];

    for (const filePath of images) {
        const name = path.parse(filePath).name;

        if (name === "1" && !avatarCandidate) {
            avatarCandidate = filePath;
            continue;
        }

        if (name === "2" && !coverCandidate) {
            coverCandidate = filePath;
            continue;
        }

        rest.push(filePath);
    }

    return {
        avatarCandidate,
        coverCandidate,
        rest,
        all: images,
    };
}


async function readDirectoryEntries(directoryPath) {
    try {
        return await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw error;
    }
}


async function isDirectory(directoryPath) {
    try {
        return (await stat(directoryPath)).isDirectory();
    } catch {
        return false;
    }
}


export async function listPhotoSetFiles(setDirectory) {
    const entries = await readDirectoryEntries(setDirectory);
    const files = [];

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(setDirectory, entry.name);
        if (isSupportedPhotoFile(filePath)) files.push(filePath);
    }

    return files.sort((left, right) => path.basename(left)
        .localeCompare(path.basename(right), "en", { sensitivity: "base" }));
}


function genderDirectory(photosDirectory, gender) {
    const folderName = genderFolders[gender];
    if (!folderName || !photosDirectory) return null;
    return path.join(path.resolve(photosDirectory), folderName);
}


export async function listAvailablePhotoSets(photosDirectory, gender) {
    const directory = genderDirectory(photosDirectory, gender);
    if (!directory) return [];

    const entries = await readDirectoryEntries(directory);
    const sets = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || isClaimedPhotoSetName(entry.name)) {
            continue;
        }

        sets.push({
            path: path.join(directory, entry.name),
            name: entry.name,
            gender,
        });
    }

    return sets.sort((left, right) => left.name.localeCompare(
        right.name,
        "en",
        { sensitivity: "base" }
    ));
}


export async function renamePhotoSet(setPath, profileNo) {
    const absolutePath = path.resolve(setPath);
    const info = await stat(absolutePath);

    if (!info.isDirectory()) {
        throw new Error("Шлях папки фото не є директорією");
    }

    const targetPath = path.join(
        path.dirname(absolutePath),
        buildClaimedPhotoSetName(profileNo)
    );

    if (absolutePath === targetPath) return targetPath;

    await rename(absolutePath, targetPath);
    return targetPath;
}


export async function takeNextPhotoSet(photosDirectory, gender, profileNo) {
    const directory = genderDirectory(photosDirectory, gender);
    if (!directory) return null;

    const claimedName = buildClaimedPhotoSetName(profileNo);
    const claimedPath = path.join(directory, claimedName);
    if (await isDirectory(claimedPath)) {
        return {
            path: claimedPath,
            name: claimedName,
            gender,
            files: await listPhotoSetFiles(claimedPath),
        };
    }

    const nextSet = (await listAvailablePhotoSets(photosDirectory, gender))[0]
        ?? null;
    if (!nextSet) return null;

    const renamedPath = await renamePhotoSet(nextSet.path, profileNo);
    return {
        path: renamedPath,
        name: path.basename(renamedPath),
        gender,
        files: await listPhotoSetFiles(renamedPath),
    };
}
