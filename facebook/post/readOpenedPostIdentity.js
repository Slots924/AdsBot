import { postDialogSelector } from "../selectors/post.js";


export function normalizeFacebookNumericPostId(value) {
    return String(value ?? "").trim().match(/^(?:\d+_)?([1-9]\d*)$/)?.[1] ?? null;
}


// Виконується у браузері: беремо лише Story, пов'язану з URL відкритого допису.
export function readOpenedPostIdentityInPage(dialogSelector) {
    const extractUrlPostId = (value) => {
        try {
            const url = new URL(value, location.href);
            if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
            const segments = url.pathname.split("/").filter(Boolean);
            const index = segments.indexOf("posts");
            return url.searchParams.get("story_fbid")
                || (index >= 0 ? segments[index + 1] : null)
                || null;
        } catch { return null; }
    };
    const urlPostId = extractUrlPostId(location.href);
    if (!urlPostId) return null;
    const dialog = Array.from(document.querySelectorAll(dialogSelector)).find((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0
            && style.display !== "none" && style.visibility !== "hidden"
            && style.opacity !== "0";
    });
    if (!dialog) return null;

    if (/^[1-9]\d*$/.test(urlPostId)) return { postId: urlPostId, urlPostId };

    try {
        const source = require("RelayFBEnvironment").getStore().getSource();
        const matches = new Map();
        for (const recordId of source.getRecordIDs()) {
            const record = source.get(recordId);
            if (record?.__typename !== "Story" || !/^[1-9]\d*$/.test(record.post_id ?? "")) continue;
            const matchesUrl = Object.entries(record).some(([key, value]) => (
                (key === "url" || key.startsWith("url("))
                && typeof value === "string"
                && extractUrlPostId(value) === urlPostId
            ));
            if (matchesUrl) matches.set(record.post_id, {
                postId: record.post_id, urlPostId, storyId: record.id ?? recordId,
            });
        }
        // Не підтверджуємо пост за неоднозначними або відсутніми даними runtime.
        return matches.size === 1 ? matches.values().next().value : null;
    } catch { return null; }
}


export default async function readOpenedPostIdentity(page, { timeout = 15000 } = {}) {
    const handle = await page.waitForFunction(readOpenedPostIdentityInPage, { timeout }, postDialogSelector);
    try {
        return await handle.jsonValue();
    } finally {
        await handle.dispose();
    }
}
