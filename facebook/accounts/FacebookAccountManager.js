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


function safeAccount(account) {
    return {
        accountKey: String(account.accountKey ?? ""),
        name: String(account.name ?? ""),
        facebookUserId: String(account.facebookUserId ?? ""),
        archived: account.archived === true,
        hasUserAgent: Boolean(String(account.userAgent ?? "").trim()),
        hasAccessToken: Boolean(String(account.accessToken ?? "").trim()),
        hasCookie: Boolean(String(account.cookie ?? "").trim()),
        adsPowerProfileNo: String(account.adsPowerProfileNo ?? "").trim(),
    };
}


export default class FacebookAccountManager {
    #operation = Promise.resolve();


    constructor({ accountsFile = "./data/facebookApi/accounts.json" } = {}) {
        this.accountsFile = accountsFile;
    }


    async list() {
        return this.#enqueue(async () => {
            const store = await this.#read();
            let migrated = false;
            store.accounts.forEach((account) => {
                if (typeof account.archived !== "boolean") {
                    account.archived = false;
                    migrated = true;
                }
            });
            if (migrated) await this.#write(store);
            return store.accounts.map(safeAccount);
        });
    }


    async create(input = {}) {
        return this.#enqueue(async () => {
            const store = await this.#read();
            const accountKey = normalizeAccountKey(input.accountKey);
            if (store.accounts.some((account) => (
                String(account.accountKey).toLowerCase()
                === accountKey.toLowerCase()
            ))) {
                throw createAccountError(
                    `Facebook-акаунт "${accountKey}" уже існує`,
                    "FACEBOOK_ACCOUNT_KEY_DUPLICATE"
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
                name: "",
                facebookUserId: "",
                userAgent,
                accessToken,
                cookie: input.cookie ? normalizeFacebookCookie(input.cookie) : "",
                adsPowerProfileNo,
                metadata: {},
                archived: false,
            };
            store.accounts.push(account);
            await this.#write(store);
            return safeAccount(account);
        });
    }


    async update(accountKey, input = {}) {
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
            const userAgent = String(input.userAgent ?? "").trim();
            const accessToken = String(input.accessToken ?? "").trim();
            const cookie = typeof input.cookie === "string"
                ? input.cookie.trim()
                : input.cookie;
            if (userAgent) account.userAgent = userAgent;
            if (accessToken) account.accessToken = accessToken;
            if (cookie && (typeof cookie !== "string" || cookie.length)) {
                account.cookie = normalizeFacebookCookie(cookie);
            }
            if (String(input.adsPowerProfileNo ?? "").trim()) {
                account.adsPowerProfileNo = normalizeAdsPowerProfileNo(
                    input.adsPowerProfileNo
                );
            }
            await this.#write(store);
            return safeAccount(account);
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
            await this.#write(store);
            return safeAccount(account);
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
