function readJpegDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
        return null;
    }

    let offset = 2;
    while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xFF) {
            offset += 1;
            continue;
        }

        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
            return {
                width: buffer.readUInt16BE(offset + 7),
                height: buffer.readUInt16BE(offset + 5),
            };
        }

        if (marker === 0xD8 || marker === 0xD9 || marker === 0x01) {
            offset += 2;
            continue;
        }

        const size = buffer.readUInt16BE(offset + 2);
        if (size < 2) break;
        offset += 2 + size;
    }

    return null;
}


function readPngDimensions(buffer) {
    if (
        buffer.length < 24
        || buffer.toString("ascii", 1, 4) !== "PNG"
    ) {
        return null;
    }

    return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20),
    };
}


function readWebpDimensions(buffer) {
    if (
        buffer.length < 30
        || buffer.toString("ascii", 0, 4) !== "RIFF"
        || buffer.toString("ascii", 8, 12) !== "WEBP"
    ) {
        return null;
    }

    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X") {
        return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3),
        };
    }
    if (chunk === "VP8L") {
        const bits = buffer.readUInt32LE(21);
        return {
            width: 1 + (bits & 0x3FFF),
            height: 1 + ((bits >> 14) & 0x3FFF),
        };
    }
    if (chunk === "VP8 ") {
        return {
            width: buffer.readUInt16LE(26),
            height: buffer.readUInt16LE(28),
        };
    }

    return null;
}


export default function readImageDimensions(buffer, contentType) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    if (contentType === "image/jpeg") return readJpegDimensions(buffer);
    if (contentType === "image/png") return readPngDimensions(buffer);
    if (contentType === "image/webp") return readWebpDimensions(buffer);
    return null;
}
