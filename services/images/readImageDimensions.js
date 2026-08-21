function createImageError(message) {
    const error = new Error(message);
    error.code = "PAGE_REBUILD_IMAGE_INVALID";
    return error;
}


function readPng(buffer) {
    const signature = "89504e470d0a1a0a";
    if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) {
        return null;
    }
    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}


function readJpeg(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return null;
    }

    let offset = 2;
    while (offset + 8 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = buffer[offset + 1];
        offset += 2;
        if (marker === 0xd8 || marker === 0xd9) continue;
        if (offset + 2 > buffer.length) break;

        const length = buffer.readUInt16BE(offset);
        if (length < 2 || offset + length > buffer.length) break;
        const isSizeMarker = [
            0xc0, 0xc1, 0xc2, 0xc3,
            0xc5, 0xc6, 0xc7,
            0xc9, 0xca, 0xcb,
            0xcd, 0xce, 0xcf,
        ].includes(marker);
        if (isSizeMarker && length >= 7) {
            return {
                width: buffer.readUInt16BE(offset + 5),
                height: buffer.readUInt16BE(offset + 3),
            };
        }
        offset += length;
    }

    return null;
}


/** Повертає розміри JPG або PNG без декодування всього зображення. */
export default function readImageDimensions(buffer, contentType) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw createImageError("Файл зображення порожній");
    }

    const dimensions = contentType === "image/png"
        ? readPng(buffer)
        : contentType === "image/jpeg" ? readJpeg(buffer) : null;
    if (!dimensions?.width || !dimensions?.height) {
        throw createImageError("Не вдалося визначити розміри JPG або PNG");
    }
    return dimensions;
}
