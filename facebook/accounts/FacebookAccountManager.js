import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";


const facebookCookieNames = new Set([
    "c_user",
    "xs",
    "fr",
    "datr",
    "sb",
    "wd",
    "dpr",
    "locale",
    "presence",
    "spin",
    "oo",
    "ps_l",
    "ps_n",
    "usida",
    "i_user",
    "m_page_voice",
]);


function createAccountError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function normalizeAccountKey(value) {
    const accountKey = String(value ?? "").trim();
    if (!/^[A-Za-z0-9._-]+$/.test(accountKey)) {
        throw createAccountError(
            "accountKey може містити лише латинські літери, цифри, крапку, дефіс і підкреслення",
            "FACEBOOK_ACCOUNT_KEY_INVALID"
        );
    }
    return accountKey;
}


function normalizeAccountName(value) {
    return String(value ?? "").trim();
}


function accountKeyPattern(prefix) {
    return new RegExp(`^${prefix}-(\\d{3,})$`, "i");
}


function nextInternalAccountKey(store, prefix = "account") {
    const pattern = accountKeyPattern(prefix);
    const maximum = store.accounts.reduce((currentMaximum, account) => {
        const match = String(account?.accountKey ?? "").trim().match(
            pattern
        );
        return match ? Math.max(currentMaximum, Number(match[1])) : currentMaximum;
    }, 0);
    const nextNumber = Math.max(
        Number(store.nextAccountNumber) || 1,
        maximum + 1
    );
    store.nextAccountNumber = nextNumber + 1;
    return `${prefix}-${String(nextNumber).padStart(3, "0")}`;
}


function normalizeAdsPowerProfileNo(value) {
    const profileNo = String(value ?? "").trim();
    if (!profileNo) return "";
    if (!/^\d+$/.test(profileNo)) {
        throw createAccountError(
            "Номер AdsPower має містити лише цифри",
            "ADSPOWER_PROFILE_NO_INVALID"
        );
    }
    return profileNo;
}


function isFacebookCookieDomain(value) {
    const domain = String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/^\./, "");
    return domain === "facebook.com" || domain.endsWith(".facebook.com");
}


function cookiePairsFromArray(cookies) {
    return cookies
        .filter((cookie) => (
            cookie
            && typeof cookie === "object"
            && isFacebookCookieDomain(cookie.domain)
            && facebookCookieNames.has(String(cookie.name ?? "").trim())
        ))
        .map((cookie) => ({
            name: String(cookie.name).trim(),
            value: String(cookie.value ?? ""),
        }));
}


function cookiePairsFromHeader(header) {
    return String(header ?? "")
        .split(";")
        .map((part) => {
            const separator = part.indexOf("=");
            if (separator < 1) return null;
            return {
                name: part.slice(0, separator).trim(),
                value: part.slice(separator + 1).trim(),
            };
        })
        .filter((cookie) => cookie && facebookCookieNames.has(cookie.name));
}


function extractCookieArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.cookies)) return value.cookies;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.data?.cookies)) return value.data.cookies;
    return null;
}


export function normalizeFacebookCookie(value) {
    let source = value;
    if (typeof source === "string") {
        const text = source.trim();
        if (!text) {
            throw createAccountError(
                "Вкажіть Facebook cookies",
                "FACEBOOK_ACCOUNT_COOKIE_REQUIRED"
            );
        }
        if (text.startsWith("[") || text.startsWith("{")) {
            try {
                source = JSON.parse(text);
            } catch {
                throw createAccountError(
                    "Cookie JSON має некоректний формат",
                    "FACEBOOK_ACCOUNT_COOKIE_JSON_INVALID"
                );
            }
        }
    }

    const array = extractCookieArray(source);
    const pairs = array
        ? cookiePairsFromArray(array)
        : cookiePairsFromHeader(source);
    const unique = new Map();
    pairs.forEach(({ name, value: cookieValue }) => {
        if (cookieValue) unique.set(name, cookieValue);
    });
    if (!unique.size) {
        throw createAccountError(
            "Не знайдено придатних cookies домену facebook.com",
            "FACEBOOK_ACCOUNT_COOKIE_INVALID"
        );
    }
    return [...unique.entries()]
        .map(([name, cookieValue]) => `${name}=${cookieValue}`)
        .join("; ");
}


function safeAccount(account, primaryAccountKey = "") {
    return {
        accountKey: String(account.accountKey ?? ""),
        name: String(account.name ?? ""),
        facebookUserId: String(account.facebookUserId ?? ""),
        archived: account.archived === true,
        hasUserAgent: Boolean(String(account.userAgent ?? "").trim()),
        hasAccessToken: Boolean(String(account.accessToken ?? "").trim()),
        hasCookie: Boolean(String(account.cookie ?? "").trim()),
        adsPowerProfileNo: String(account.adsPowerProfileNo ?? "").trim(),
        proxyId: String(account.proxyId ?? "").trim(),
        kind: String(account.kind ?? "api"),
        isPrimary: Boolean(primaryAccountKey && account.accountKey === primaryAccountKey),
    };
}


export default class FacebookAccountManager {
    #operation = Promise.resolve();


    constructor({ accountsFile = "./data/facebookApi/accounts.json", kind = "api" } = {}) {
        this.accountsFile = accountsFile;
        this.kind = kind;
        this.keyPrefix = kind === "bm" ? "bm" : kind === "system" ? "system" : "account";
    }


    async list() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            if (this.#migrateAccounts(store)) await this.#write(store);
            return store.accounts.map((account) => safeAccount(account, store.primaryAccountKey));
        });
    }


    async migrateLegacyAccountKeys() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            if (!this.#migrateAccounts(store)) return [];
            await this.#write(store);
            return store.accounts.map((account) => safeAccount(account, store.primaryAccountKey));
        });
    }


    async create(input = {}) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            this.#migrateAccounts(store);
            const accountKey = nextInternalAccountKey(store, this.keyPrefix);
            const name = normalizeAccountName(input.name);
            if (!name) {
                throw createAccountError(
                    "Вкажіть назву API-клієнта",
                    "FACEBOOK_ACCOUNT_NAME_REQUIRED"
                );
            }
            const userAgent = String(input.userAgent ?? "").trim();
            const accessToken = String(input.accessToken ?? "").trim();
            const adsPowerProfileNo = normalizeAdsPowerProfileNo(
                input.adsPowerProfileNo
            );
            if (!adsPowerProfileNo && !userAgent) {
                throw createAccountError(
                    "Вкажіть userAgent",
                    "FACEBOOK_ACCOUNT_USER_AGENT_REQUIRED"
                );
            }
            if (!adsPowerProfileNo && !accessToken) {
                throw createAccountError(
                    "Вкажіть accessToken",
                    "FACEBOOK_ACCOUNT_ACCESS_TOKEN_REQUIRED"
                );
            }
            const account = {
                accountKey,
                name,
                facebookUserId: "",
                userAgent,
                accessToken,
                cookie: this.kind === "system" ? "" : input.cookie ? normalizeFacebookCookie(input.cookie) : "",
                adsPowerProfileNo,
                proxyId: String(input.proxyId ?? "").trim(),
                kind: this.kind,
                metadata: {},
                archived: false,
            };
            store.accounts.push(account);
            if (this.kind !== "api" && !store.primaryAccountKey) store.primaryAccountKey = accountKey;
            await this.#write(store);
            return safeAccount(account, store.primaryAccountKey);
        });
    }


    async update(accountKey, input = {}) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            this.#migrateAccounts(store);
            const normalizedKey = normalizeAccountKey(accountKey);
            const account = store.accounts.find((item) => (
                String(item.accountKey).toLowerCase()
                === normalizedKey.toLowerCase()
            ));
            if (!account) {
                throw createAccountError(
                    `Facebook-акаунт "${normalizedKey}" не знайдено`,
                    "FACEBOOK_ACCOUNT_NOT_FOUND"
                );
            }
            const userAgent = String(input.userAgent ?? "").trim();
            const accessToken = String(input.accessToken ?? "").trim();
            const cookie = typeof input.cookie === "string"
                ? input.cookie.trim()
                : input.cookie;
            if (Object.hasOwn(input, "name")) {
                const name = normalizeAccountName(input.name);
                if (!name) {
                    throw createAccountError(
                        "Вкажіть назву API-клієнта",
                        "FACEBOOK_ACCOUNT_NAME_REQUIRED"
                    );
                }
                account.name = name;
            }
            if (userAgent) account.userAgent = userAgent;
            if (accessToken) account.accessToken = accessToken;
            if (this.kind !== "system" && cookie && (typeof cookie !== "string" || cookie.length)) {
                account.cookie = normalizeFacebookCookie(cookie);
            }
            if (String(input.adsPowerProfileNo ?? "").trim()) {
                account.adsPowerProfileNo = normalizeAdsPowerProfileNo(
                    input.adsPowerProfileNo
                );
            }
            if (Object.hasOwn(input, "proxyId")) {
                account.proxyId = String(input.proxyId ?? "").trim();
            }
            await this.#write(store);
            return safeAccount(account, store.primaryAccountKey);
        });
    }


    async get(accountKey) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            this.#migrateAccounts(store);
            const normalizedKey = normalizeAccountKey(accountKey);
            const account = store.accounts.find((item) => (
                String(item.accountKey).toLowerCase()
                === normalizedKey.toLowerCase()
            ));
            if (!account) {
                throw createAccountError(
                    `Facebook-акаунт "${normalizedKey}" не знайдено`,
                    "FACEBOOK_ACCOUNT_NOT_FOUND"
                );
            }
            return safeAccount(account, store.primaryAccountKey);
        });
    }


    async setArchived(accountKey, archived) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const normalizedKey = normalizeAccountKey(accountKey);
            const account = store.accounts.find((item) => (
                String(item.accountKey).toLowerCase()
                === normalizedKey.toLowerCase()
            ));
            if (!account) {
                throw createAccountError(
                    `Facebook-акаунт "${normalizedKey}" не знайдено`,
                    "FACEBOOK_ACCOUNT_NOT_FOUND"
                );
            }
            account.archived = Boolean(archived);
            if (this.kind !== "api" && account.archived && store.primaryAccountKey === account.accountKey) {
                store.primaryAccountKey = store.accounts.find((item) => !item.archived)?.accountKey ?? "";
            }
            if (this.kind !== "api" && !account.archived && !store.primaryAccountKey) {
                store.primaryAccountKey = account.accountKey;
            }
            await this.#write(store);
            return safeAccount(account, store.primaryAccountKey);
        });
    }

    async setPrimary(accountKey) {
        if (this.kind === "api") throw createAccountError("Для API-клієнтів основний запис не обирається", "ACCOUNT_PRIMARY_UNSUPPORTED");
        return this.#enqueue(async () => {
            const store = await this.#read();
            this.#migrateAccounts(store);
            const key = normalizeAccountKey(accountKey);
            const selected = store.accounts.find((account) => account.accountKey === key && !account.archived);
            if (!selected) throw createAccountError("Клієнта не знайдено", "FACEBOOK_ACCOUNT_NOT_FOUND");
            store.primaryAccountKey = key;
            await this.#write(store);
            return store.accounts.map((account) => safeAccount(account, key));
        });
    }


    async delete(accountKey) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const normalizedKey = normalizeAccountKey(accountKey);
            const index = store.accounts.findIndex((item) => (
                String(item.accountKey).toLowerCase()
                === normalizedKey.toLowerCase()
            ));
            if (index === -1) {
                throw createAccountError(
                    `Facebook-акаунт "${normalizedKey}" не знайдено`,
                    "FACEBOOK_ACCOUNT_NOT_FOUND"
                );
            }
            const [deleted] = store.accounts.splice(index, 1);
            if (store.primaryAccountKey === deleted.accountKey) {
                store.primaryAccountKey = store.accounts.find((account) => !account.archived)?.accountKey ?? "";
            }
            await this.#write(store);
            return safeAccount(deleted);
        });
    }


    async deleteArchived() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const deleted = store.accounts.filter((account) => (
                account.archived === true
            ));
            if (!deleted.length) return [];
            store.accounts = store.accounts.filter((account) => (
                account.archived !== true
            ));
            if (!store.accounts.some((account) => account.accountKey === store.primaryAccountKey)) {
                store.primaryAccountKey = store.accounts.find((account) => !account.archived)?.accountKey ?? "";
            }
            await this.#write(store);
            return deleted.map((account) => safeAccount(account));
        });
    }


    #enqueue(operation) {
        const result = this.#operation.then(operation, operation);
        this.#operation = result.catch(() => {});
        return result;
    }


    async #read() {
        try {
            const parsed = JSON.parse(await readFile(this.accountsFile, "utf8"));
            return {
                ...parsed,
                accounts: Array.isArray(parsed?.accounts)
                    ? parsed.accounts
                    : [],
            };
        } catch (error) {
            if (error.code === "ENOENT") return { accounts: [] };
            throw error;
        }
    }


    #migrateAccounts(store) {
        const pattern = accountKeyPattern(this.keyPrefix);
        let changed = false;
        const usedKeys = new Set();
        let nextNumber = 1;

        const nextKey = () => {
            while (usedKeys.has(`${this.keyPrefix}-${String(nextNumber).padStart(3, "0")}`)) {
                nextNumber += 1;
            }
            const key = `${this.keyPrefix}-${String(nextNumber).padStart(3, "0")}`;
            usedKeys.add(key);
            nextNumber += 1;
            return key;
        };

        store.accounts.forEach((account) => {
            const currentKey = String(account?.accountKey ?? "").trim();
            const normalizedKey = currentKey.toLowerCase();
            if (pattern.test(currentKey) && !usedKeys.has(normalizedKey)) {
                account.accountKey = normalizedKey;
                usedKeys.add(normalizedKey);
                const number = Number(normalizedKey.match(pattern)[1]);
                nextNumber = Math.max(nextNumber, number + 1);
                if (currentKey !== normalizedKey) changed = true;
                return;
            }

            account.accountKey = nextKey();
            account.name = currentKey || "Без назви";
            changed = true;
        });

        store.accounts.forEach((account) => {
            if (account.kind !== this.kind) {
                account.kind = this.kind;
                changed = true;
            }
            if (typeof account.archived !== "boolean") {
                account.archived = false;
                changed = true;
            }
        });
        const maximum = store.accounts.reduce((currentMaximum, account) => {
            const match = String(account.accountKey ?? "").match(
                pattern
            );
            return match ? Math.max(currentMaximum, Number(match[1])) : currentMaximum;
        }, 0);
        const nextAccountNumber = Number(store.nextAccountNumber);
        if (!Number.isInteger(nextAccountNumber) || nextAccountNumber <= maximum) {
            store.nextAccountNumber = maximum + 1;
            changed = true;
        }
        if (this.kind !== "api" && !store.accounts.some((account) => account.accountKey === store.primaryAccountKey && !account.archived)) {
            const nextPrimaryKey = store.accounts.find((account) => !account.archived)?.accountKey ?? "";
            if (store.primaryAccountKey !== nextPrimaryKey) {
                store.primaryAccountKey = nextPrimaryKey;
                changed = true;
            }
        }
        return changed;
    }


    async #write(store) {
        await mkdir(path.dirname(this.accountsFile), { recursive: true });
        const temporaryFile = `${this.accountsFile}.tmp`;
        await writeFile(
            temporaryFile,
            `${JSON.stringify(store, null, 2)}\n`,
            "utf8"
        );
        await rename(temporaryFile, this.accountsFile);
    }
}
