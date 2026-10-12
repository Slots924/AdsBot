import { readFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import axios from "axios";
import createFacebookApiClients from "../../facebook/api/createFacebookApiClients.js";
import RemoteDataCacheStore from "../../services/gui/RemoteDataCacheStore.js";
import { hasLinkInPostText } from "../../facebook/workflows/collectLatestPagePostsWithLinks.js";

const [accountName, pageId] = process.argv.slice(2);
let temporaryDirectory;

try {
    if (!accountName || !/^\d+$/.test(pageId ?? "")) throw new Error("DIAGNOSTIC_ARGUMENTS_INVALID");
    const config = JSON.parse(await readFile("./data/facebookApi/accounts.json", "utf8"));
    const matches = (config.accounts ?? []).filter((account) => !account.archived && (
        String(account.name ?? "").toLocaleLowerCase() === accountName.toLocaleLowerCase()
        || String(account.accountKey ?? "").toLocaleLowerCase() === accountName.toLocaleLowerCase()
    ));
    if (matches.length !== 1) throw new Error("DIAGNOSTIC_ACCOUNT_NOT_UNIQUE");
    let rawPosts = [];
    const requests = [];
    const clients = await createFacebookApiClients({
        onlyAccountKey: matches[0].accountKey,
        httpClient: {
            async request(config) {
                const endpoint = new URL(config.url).pathname;
                if (String(config.method).toLowerCase() !== "get") throw new Error("DIAGNOSTIC_READ_ONLY");
                const response = await axios.request(config);
                requests.push({ endpoint, limit: config.params?.limit ?? null });
                // Не зберігаємо заголовки, токени, cookies або параметри проксі.
                if (endpoint.endsWith(`/${pageId}/published_posts`)) rawPosts = response.data?.data ?? [];
                return response;
            },
        },
    });
    const api = clients.get(matches[0].accountKey);
    if (!api) throw new Error("DIAGNOSTIC_CLIENT_UNAVAILABLE");
    const posts = await api.getLatestPagePostsWithLinks({ pageId, limit: 5, includeAll: true });
    // Перевіряємо справжній клас кешу в окремому тимчасовому файлі.
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "adsbot-post-diagnostic-"));
    const cache = new RemoteDataCacheStore({ cacheFile: path.join(temporaryDirectory, "cache.json") });
    await cache.setPosts(matches[0].accountKey, pageId, posts.map(({ thumbnailUrl, ...post }) => post), "campaign");
    const visible = (await cache.getPosts(matches[0].accountKey, pageId)).value;
    console.log(JSON.stringify({
        pageId, requests, returnedCount: rawPosts.length,
        posts: rawPosts.map((post) => {
            const normalized = posts.find((item) => item.id === String(post.id));
            const message = String(post.message ?? "");
            return {
                id: post.id, createdTime: post.created_time, published: post.is_published,
                textLength: message.length, firstUrlIndex: message.search(/https?:\/\/[^\s]+/i),
                hasUrlInFullText: hasLinkInPostText(post),
                hasUrlInOldTruncatedText: hasLinkInPostText({ message: message.length > 500 ? message.slice(0, 497) : message }),
                attachmentCount: post.attachments?.data?.length ?? 0,
                normalizedTextMatches: normalized?.message === message,
                visibleInGuiCache: visible.some((item) => item.id === String(post.id)),
            };
        }),
        visiblePostIds: visible.map((post) => post.id),
    }, null, 2));
} catch (error) {
    // Виводимо лише код, щоб транспортна помилка не розкрила секрети.
    console.error(JSON.stringify({ failed: true, code: error.code ?? (String(error.message).startsWith("DIAGNOSTIC_") ? error.message : "DIAGNOSTIC_FAILED"), graphCode: error.response?.data?.error?.code ?? null }));
    process.exitCode = 1;
} finally {
    if (temporaryDirectory) {
        for (const filename of ["cache.json", "cache.json.bak"]) await unlink(path.join(temporaryDirectory, filename)).catch(() => {});
        await rmdir(temporaryDirectory).catch(() => {});
    }
}
