import { readFile } from "node:fs/promises";
import path from "node:path";


const contentTypes = new Map([
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".png", "image/png"],
    [".webp", "image/webp"],
]);


function createImageError(message) {
    const error = new Error(message);
    error.code = "FACEBOOK_POST_IMAGE_ERROR";
    return error;
}


/**
 * Завантажує локальну картинку у форматі, потрібному workflow публікації.
 * @param {string} imagePath Шлях до JPG, JPEG, PNG або WEBP.
 * @returns {Promise<{buffer: Buffer, filename: string, contentType: string}>}
 * @throws {Error} FACEBOOK_POST_IMAGE_ERROR.
 */
export default async function loadImageFromPath(imagePath) {
    const normalizedPath = String(imagePath ?? "").trim();

    if (!normalizedPath) {
        throw createImageError("Не вказано шлях до картинки");
    }

    const absolutePath = path.resolve(normalizedPath);
    const contentType = contentTypes.get(
        path.extname(absolutePath).toLowerCase()
    );

    if (!contentType) {
        throw createImageError(
            "Підтримуються лише картинки JPG, JPEG, PNG і WEBP"
        );
    }

    let buffer;

    try {
        buffer = await readFile(absolutePath);
    } catch {
        throw createImageError("Не вдалося прочитати файл картинки");
    }

    if (buffer.length === 0) {
        throw createImageError("Файл картинки порожній");
    }

    return {
        buffer,
        filename: path.basename(absolutePath),
        contentType,
    };
}
