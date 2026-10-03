const queues = new WeakMap();

export function normalizePlatformDomain(value) {
    try {
        const text = String(value ?? "").trim();
        return new URL(text.includes("://") ? text : `https://${text}`)
            .hostname.toLowerCase().replace(/^www\./, "");
    } catch { return ""; }
}

export function getPlatformCredentials(profile, domain) {
    const target = normalizePlatformDomain(domain);
    if (!target) throw new Error("Некоректний домен платформи");
    const matches = (profile.platform_account ?? []).filter((account) =>
        normalizePlatformDomain(account.domain_name) === target);
    if (matches.length > 1) throw new Error("У профілі декілька записів потрібної платформи");
    const account = matches[0] ?? (normalizePlatformDomain(profile.platform) === target
        ? { login_user: profile.username, password: profile.password, fakey: profile.fakey }
        : null);
    if (!account) return null;
    if (!account.login_user || !account.password) throw new Error("Облікові дані платформи неповні");
    return { login: account.login_user, password: account.password, twoFactorKey: account.fakey || null };
}

export const getFacebookCredentials = (profile) => getPlatformCredentials(profile, "facebook.com");
export const getFirstmailCredentials = (profile) => getPlatformCredentials(profile, "firstmail.ltd");

export function appendRecoveryPasswordNote(remark, newPassword) {
    if (typeof newPassword !== "string" || !newPassword) throw new Error("Новий пароль не може бути порожнім");
    const note = `Новий пароль Facebook: ${newPassword}`;
    const previous = String(remark ?? "");
    const result = previous.split(/\r?\n/).includes(note)
        ? previous : `${previous}${previous && !previous.endsWith("\n") ? "\n" : ""}${note}`;
    if (result.length > 1500) throw new Error("Нотатки перевищують ліміт; наявні записи не обрізано");
    return result;
}

// Серіалізуємо читання та запис одного профілю, щоб не втрачати локальні зміни.
function withProfileLock(adsPower, profileId, operation) {
    if (!queues.has(adsPower)) queues.set(adsPower, new Map());
    const queue = queues.get(adsPower);
    const key = String(profileId);
    const current = (queue.get(key) ?? Promise.resolve()).then(operation, operation);
    const settled = current.catch(() => {});
    queue.set(key, settled);
    settled.finally(() => { if (queue.get(key) === settled) queue.delete(key); });
    return current;
}

async function updateUnlocked(adsPower, profileId, domain, changes, appendNote = false) {
    const target = normalizePlatformDomain(domain);
    if (!target || !changes || Object.keys(changes).some((key) => !["login", "password", "twoFactorKey"].includes(key))) {
        throw new Error("Некоректні зміни облікових даних");
    }
    for (const key of ["login", "password"]) {
        if (key in changes && (typeof changes[key] !== "string" || !changes[key])) {
            throw new Error("Логін і пароль не можуть бути порожніми");
        }
    }
    if ("twoFactorKey" in changes && changes.twoFactorKey !== null && typeof changes.twoFactorKey !== "string") {
        throw new Error("Ключ 2FA має бути рядком або null");
    }
    const profile = await adsPower.getProfileById(profileId);
    const credentials = getPlatformCredentials(profile, target);
    if (!credentials) throw new Error("Платформа відсутня у профілі");
    const accounts = (profile.platform_account ?? []).map((account) => ({ ...account }));
    let account = accounts.find((item) => normalizePlatformDomain(item.domain_name) === target);
    if (!account) {
        account = { domain_name: target, login_user: credentials.login, password: credentials.password, fakey: credentials.twoFactorKey ?? "" };
        accounts.push(account);
    }
    const fields = { login: "login_user", password: "password", twoFactorKey: "fakey" };
    for (const [key, value] of Object.entries(changes)) account[fields[key]] = value ?? "";
    const payload = { platform_account: accounts };
    const isPrimary = normalizePlatformDomain(profile.platform) === target;
    if (isPrimary) {
        for (const [key, value] of Object.entries(changes)) {
            payload[key === "login" ? "username" : key === "twoFactorKey" ? "fakey" : key] = value ?? "";
        }
    }
    if (appendNote) {
        payload.remark = appendRecoveryPasswordNote(profile.remark, changes.password);
    }
    await adsPower.updateProfileCredentials(profileId, payload);
    const saved = await adsPower.getProfileById(profileId);
    const actual = getPlatformCredentials(saved, target);
    if (Object.entries(changes).some(([key, value]) => (actual?.[key] ?? "") !== (value ?? ""))
        || (isPrimary && Object.entries(payload).some(([key, value]) => key !== "platform_account" && saved[key] !== value))
        || (appendNote && saved.remark !== payload.remark)
        || accounts.some((expected) => !(saved.platform_account ?? []).some((item) =>
            ["domain_name", "login_user", "password", "fakey"].every((key) => (item[key] ?? "") === (expected[key] ?? ""))))) {
        throw new Error("Перевірка збережених даних AdsPower не пройшла");
    }
    return { credentialsSaved: true };
}

export function updatePlatformCredentials(adsPower, profileId, domain, changes) {
    return withProfileLock(adsPower, profileId, () => updateUnlocked(adsPower, profileId, domain, changes));
}

export function saveRecoveredFacebookPassword(adsPower, profileId, newPassword) {
    return withProfileLock(adsPower, profileId, () =>
        updateUnlocked(adsPower, profileId, "facebook.com", { password: newPassword }, true));
}
