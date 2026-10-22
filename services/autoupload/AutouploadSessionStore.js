import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export default class AutouploadSessionStore {
    #queue = Promise.resolve();
    constructor({ directory, encrypt, decrypt }) {
        if (!directory || typeof encrypt !== "function" || typeof decrypt !== "function") throw new Error("Не налаштоване захищене сховище сесій");
        Object.assign(this, { directory: path.resolve(directory), encrypt, decrypt });
    }
    #file(profileId) {
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(profileId))) throw new Error("Некоректний ID профілю");
        return path.join(this.directory, `${createHash("sha256").update(String(profileId)).digest("hex")}.json`);
    }
    #change(action) {
        const operation = this.#queue.then(action);
        this.#queue = operation.catch(() => {});
        return operation;
    }
    save(profileId, session) {
        return this.#change(async () => {
            const file = this.#file(profileId);
            try {
                const encrypted = this.encrypt(JSON.stringify({ ...session, profileId: String(profileId) }));
                await mkdir(this.directory, { recursive: true });
                await writeFile(`${file}.tmp`, JSON.stringify({ version: 1, encrypted }), { encoding: "utf8", mode: 0o600 });
                await rename(`${file}.tmp`, file);
            } catch { throw new Error("Не вдалося зашифрувати або зберегти сесію профілю"); }
        });
    }
    async load(profileId) {
        await this.#queue;
        const file = this.#file(profileId);
        try {
            const envelope = JSON.parse(await readFile(file, "utf8"));
            if (envelope.version !== 1 || typeof envelope.encrypted !== "string") throw new Error();
            const session = JSON.parse(this.decrypt(envelope.encrypted));
            if (session.profileId !== String(profileId)) throw new Error();
            return session;
        } catch (error) {
            if (error.code === "ENOENT") return null;
            throw new Error("Не вдалося прочитати захищену сесію. Запустіть нову перевірку профілю");
        }
    }
    remove(profileId) {
        return this.#change(async () => {
            try { await unlink(this.#file(profileId)); }
            catch (error) { if (error.code !== "ENOENT") throw new Error("Не вдалося видалити попередню сесію профілю"); }
        });
    }
}
