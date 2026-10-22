export default function createSecretStorage(safeStorage) {
    const ensureAvailable = () => {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Системне шифрування Electron недоступне");
    };
    return {
        encrypt(value) { ensureAvailable(); return safeStorage.encryptString(String(value)).toString("base64"); },
        decrypt(value) { ensureAvailable(); return safeStorage.decryptString(Buffer.from(String(value), "base64")); },
    };
}
