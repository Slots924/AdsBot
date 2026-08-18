import { readFile } from "node:fs/promises";
import path from "node:path";

import ProxyHttpClient from "../../services/proxy/ProxyHttpClient.js";
import FacebookGraphApi from "./FacebookGraphApi.js";


async function readJson(filePath, label) {
    const absolutePath = path.resolve(filePath);

    try {
        const content = await readFile(absolutePath, "utf8");
        return JSON.parse(content);
    } catch (error) {
        throw new Error(
            `Не вдалося прочитати ${label} "${absolutePath}": ${error.message}`
        );
    }
}


function normalizeAccounts(accounts) {
    if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error("Список Facebook-акаунтів порожній");
    }

    const seenKeys = new Set();

    return accounts.map((account, index) => {
        const accountKey = String(account?.accountKey ?? "").trim();
        const accessToken = String(account?.accessToken ?? "").trim();
        const cookie = String(account?.cookie ?? "").trim();
        const userAgent = String(account?.userAgent ?? "").trim();

        if (!accountKey) {
            throw new Error(
                `Facebook-акаунт ${index + 1} не містить accountKey`
            );
        }

        if (seenKeys.has(accountKey)) {
            throw new Error(
                `accountKey "${accountKey}" дублюється`
            );
        }

        if (!accessToken) {
            throw new Error(
                `Facebook-акаунт "${accountKey}" не містить accessToken`
            );
        }

        if (!userAgent) {
            throw new Error(
                `Facebook-акаунт "${accountKey}" не містить userAgent`
            );
        }

        if (!cookie) {
            throw new Error(
                `Facebook-акаунт "${accountKey}" не містить cookie`
            );
        }

        if (
            account?.metadata !== undefined
            && (
                !account.metadata
                || Array.isArray(account.metadata)
                || typeof account.metadata !== "object"
            )
        ) {
            throw new Error(
                `metadata акаунта "${accountKey}" має бути об'єктом`
            );
        }

        seenKeys.add(accountKey);

        return {
            accountKey,
            accessToken,
            cookie,
            userAgent,
            name: String(account?.name ?? ""),
            facebookUserId: String(account?.facebookUserId ?? ""),
            metadata: account?.metadata ?? {},
        };
    });
}


/**
 * Створює Facebook API-клієнти зі спільним proxy transport.
 * @param {object} options Шляхи конфігів і залежності для перевірок.
 * @returns {Promise<Map<string, FacebookGraphApi>>}
 */
export default async function createFacebookApiClients({
    accountsFilePath = "./data/facebookApi/accounts.json",
    proxiesFilePath = "./data/facebookApi/proxies.json",
    httpClient,
    checkProxyFn,
} = {}) {
    const [accountsConfig, proxiesConfig] = await Promise.all([
        readJson(accountsFilePath, "конфіг Facebook-акаунтів"),
        readJson(proxiesFilePath, "конфіг проксі"),
    ]);
    const accounts = normalizeAccounts(accountsConfig?.accounts);
    const proxyHttpClient = new ProxyHttpClient({
        proxies: proxiesConfig?.proxies,
        ...(httpClient ? { httpClient } : {}),
        ...(checkProxyFn ? { checkProxyFn } : {}),
    });
    const clients = new Map();

    accounts.forEach((account) => {
        clients.set(
            account.accountKey,
            new FacebookGraphApi({
                accountKey: account.accountKey,
                accessToken: account.accessToken,
                cookie: account.cookie,
                userAgent: account.userAgent,
                proxyHttpClient,
            })
        );
    });

    return clients;
}
