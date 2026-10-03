import { readFile } from "node:fs/promises";

export default async function readRecoveryPassword() {
    if (process.env.FACEBOOK_RECOVERY_NEW_PASSWORD) return process.env.FACEBOOK_RECOVERY_NEW_PASSWORD;
    try {
        const config = JSON.parse(await readFile(new URL("../../data/local-secrets/facebook-recovery.json", import.meta.url), "utf8"));
        if (typeof config.newPassword !== "string" || !config.newPassword) throw new Error("INVALID_CONFIG");
        return config.newPassword;
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw new Error("Некоректна локальна конфігурація пароля recovery");
    }
}
