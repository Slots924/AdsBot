import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export default class CRM {
    #operation = Promise.resolve();

    constructor({ settingsFile, encrypt, decrypt }) {
        this.settingsFile = settingsFile;
        this.encrypt = encrypt;
        this.decrypt = decrypt;
    }

    getSettings() {
        return this.#enqueue(async () => {
            let stored;
            try {
                stored = JSON.parse(await readFile(this.settingsFile, "utf8"));
            } catch (error) {
                if (error.code === "ENOENT") return { login: "", password: "", session: "" };
                throw error;
            }
            return Object.fromEntries(["login", "password", "session"].map((key) =>
                [key, stored[key] ? this.decrypt(stored[key]) : ""]));
        });
    }

    saveSettings(input = {}) {
        return this.#enqueue(async () => {
            const values = Object.fromEntries(["login", "password", "session"].map((key) =>
                [key, String(input[key] ?? "")]));
            const encrypted = Object.fromEntries(Object.entries(values).map(([key, value]) =>
                [key, value ? this.encrypt(value) : ""]));
            await mkdir(path.dirname(this.settingsFile), { recursive: true });
            const temporaryFile = `${this.settingsFile}.tmp`;
            await writeFile(temporaryFile, JSON.stringify(encrypted), { mode: 0o600 });
            await rename(temporaryFile, this.settingsFile);
            return values;
        });
    }

    #enqueue(operation) {
        const result = this.#operation.then(operation);
        this.#operation = result.catch(() => {});
        return result;
    }
}
