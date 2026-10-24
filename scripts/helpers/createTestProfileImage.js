import { deflateSync } from "node:zlib";

// Створює нейтральний PNG для перевірки upload без використання фото чи даних акаунтів.
export default function createTestProfileImage(width = 800, height = 400) {
    const crc = buffer => {
        let result = 0xffffffff;
        for (const value of buffer) {
            result ^= value;
            for (let bit = 0; bit < 8; bit++) result = (result >>> 1) ^ ((result & 1) ? 0xedb88320 : 0);
        }
        return (result ^ 0xffffffff) >>> 0;
    };
    const chunk = (name, data) => {
        const content = Buffer.concat([Buffer.from(name), data]);
        const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
        const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(content));
        return Buffer.concat([length, content, checksum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    const pixels = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = y * (width * 3 + 1) + 1 + x * 3;
        pixels[offset] = 40 + Math.round(x / width * 60);
        pixels[offset + 1] = 100 + Math.round(y / height * 60);
        pixels[offset + 2] = 180;
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
