import { actionError } from "../../facebook/autoupload/graphql/errors.js";

// Перетворює пряме посилання на пост у дані цілі без мережевих запитів.
export default function resolveCommentTarget(value) {
    let url;
    try { url = new URL(value); } catch { throw actionError("Некоректне посилання на пост", "FACEBOOK_POST_URL_INVALID"); }
    const pathMatch = url.pathname.match(/^\/([^/]+)\/posts\/(pfbid[A-Za-z0-9]+|[1-9]\d*)\/?$/);
    if (pathMatch) {
        url.pathname = '/permalink.php';
        url.search = new URLSearchParams({ story_fbid: pathMatch[2], id: pathMatch[1] }).toString();
    }
    const storyId = url.searchParams.get("story_fbid");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== '443') || !["www.facebook.com", "facebook.com"].includes(url.hostname)
        || url.pathname !== "/permalink.php" || !/^(?:pfbid[A-Za-z0-9]+|[1-9]\d*)$/.test(storyId ?? "")) {
        throw actionError("Потрібне пряме посилання permalink.php зі story_fbid", "FACEBOOK_POST_URL_INVALID");
    }
    return { postUrl: url.href, storyId, feedbackId: Buffer.from(`feedback:${storyId}`).toString("base64") };
}
