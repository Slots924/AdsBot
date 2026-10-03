import { readFile } from "node:fs/promises";
import path from "node:path";

import ProxyHttpClient from "../../services/proxy/ProxyHttpClient.js";
import FacebookGraphApi from "./FacebookGraphApi.js";


async function readJson(filePath, label, optional = false) {
    const absolutePath = path.resolve(filePath);

    try {
        const content = await readFile(absolutePath, "utf8");
        return JSON.parse(content);
    } catch (error) {
        if (optional && error.code === "ENOENT") return { accounts: [] };
        throw new Error(
            `Не вдалося прочитати ${label} "${absolutePath}": ${error.message}`
        );
    }
}


function normalizeAccounts(accounts) {
    if (!Array.isArray(accounts)) {
        throw new Error("Список Facebook-акаунтів порожній");
    }

    const seenKeys = new Set();

    return accounts.map((account, index) => {
        const accountKey = String(account?.accountKey ?? "").trim();
        const accessToken = String(account?.accessToken ?? "").trim();
        const cookie = String(account?.cookie ?? "").trim();
        const userAgent = String(account?.userAgent ?? "").trim();
        const adsPowerProfileNo = String(
            account?.adsPowerProfileNo ?? ""
        ).trim();

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

        const credentialsMissing = !accessToken || !userAgent || (!cookie && account.kind !== "system");
        if (credentialsMissing && adsPowerProfileNo) {
            // API-клієнт очікує фонову синхронізацію з AdsPower.
            return null;
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

        if (!cookie && account.kind !== "system") {
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
            proxyId: String(account?.proxyId ?? "").trim(),
            kind: String(account?.kind ?? "api"),
        };
    }).filter(Boolean);
}


/**
 * Створює Facebook API-клієнти зі спільним proxy transport.
 * @param {object} options Шляхи конфігів і залежності для перевірок.
 * @returns {Promise<Map<string, FacebookGraphApi>>}
 */
export default async function createFacebookApiClients({
    accountsFilePath = "./data/facebookApi/accounts.json",
    bmFilePath = "./data/facebookApi/businessManagers.json",
    proxiesFilePath = "./data/facebookApi/proxies.json",
    systemUsersFilePath,
    businessOnly = false,
    onlyAccountKey,
    httpClient,
    checkProxyFn,
} = {}) {
    const [accountsConfig, bmConfig, proxiesConfig] = await Promise.all([
        readJson(accountsFilePath, "конфіг Facebook-акаунтів"),
        readJson(bmFilePath, "конфіг BM", true),
        readJson(proxiesFilePath, "конфіг проксі"),
    ]);
    const systemConfig = systemUsersFilePath ? await readJson(systemUsersFilePath, "конфіг системних користувачів", true) : {};
    const accounts = normalizeAccounts(
        [...(businessOnly ? [] : accountsConfig?.accounts ?? []), ...(bmConfig?.accounts ?? []), ...(systemConfig?.accounts ?? []).map((item) => ({ ...item, kind: "system" }))].filter((account) => account?.archived !== true && (!onlyAccountKey || account.accountKey === onlyAccountKey))
    );
    const proxyHttpClient = new ProxyHttpClient({
        proxies: (proxiesConfig?.proxies ?? []).filter((proxy) => (
            String(proxy?.type ?? "").trim().toLowerCase() !== "no_proxy"
        )),
        ...(httpClient ? { httpClient } : {}),
        ...(checkProxyFn ? { checkProxyFn } : {}),
    });
    const facebookApiClients = new Map();

    accounts.forEach((account) => {
        const selectedProxy = account.proxyId
            ? (proxiesConfig?.proxies ?? []).find((proxy) => proxy.id === account.proxyId && proxy.type !== "no_proxy")
            : null;
        if (account.proxyId && !selectedProxy) {
            throw new Error(`Проксі "${account.proxyId}" для клієнта "${account.accountKey}" не знайдено`);
        }
        facebookApiClients.set(
            account.accountKey,
            new FacebookGraphApi({
                accountKey: account.accountKey,
                accountName: account.name,
                facebookUserId: account.facebookUserId,
                kind: account.kind,
                accessToken: account.accessToken,
                cookie: account.cookie,
                userAgent: account.userAgent,
                proxyHttpClient: selectedProxy
                    ? new ProxyHttpClient({ proxies: [selectedProxy], ...(httpClient ? { httpClient } : {}), ...(checkProxyFn ? { checkProxyFn } : {}) })
                    : proxyHttpClient,
            })
        );
    });

    return facebookApiClients;
}
