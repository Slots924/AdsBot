import { actionError, safeGraphText } from "../../graphql/errors.js";

// Шукає лише viewer.friend_requests, щоб не сплутати заявки з рекомендаціями друзів.
export function findIncomingViewers(roots) {
    const viewers = [];
    const stack = roots.map((value) => ({ value, depth: 0 }));
    let visited = 0;
    while (stack.length) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== "object" || depth > 100) continue;
        if (++visited > 150_000) throw actionError("Завелика вкладеність відповіді Facebook зі списком заявок", "FACEBOOK_INCOMING_RESPONSE_TOO_LARGE");
        if (Array.isArray(value.viewer?.friend_requests?.edges)) viewers.push(value.viewer);
        for (const child of Object.values(value)) {
            if (child && typeof child === "object") stack.push({ value: child, depth: depth + 1 });
        }
    }
    return viewers;
}

export function parseIncomingHtml(html) {
    const roots = [];
    for (const script of String(html ?? "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        if (!/\btype\s*=\s*(?:"application\/json"|'application\/json'|application\/json(?=\s|$))/i.test(script[1])) continue;
        try { roots.push(JSON.parse(script[2])); } catch {}
    }
    return findIncomingViewers(roots);
}

export function normalizeIncomingViewers(viewers, session = {}) {
    if (!viewers.length) throw actionError("Facebook не повернув viewer.friend_requests.edges", "FACEBOOK_INCOMING_REQUESTS_NOT_FOUND");
    const requests = new Map();
    const counts = [];
    const flags = [];
    const cursors = new Set();
    let malformed = false;
    for (const viewer of viewers) {
        const count = viewer.friends_container_request_count?.count;
        if (Number.isSafeInteger(count) && count >= 0) counts.push(count);
        const connection = viewer.friend_requests;
        flags.push(typeof connection.page_info?.has_next_page === "boolean" ? connection.page_info.has_next_page : null);
        if (typeof connection.page_info?.end_cursor === "string") cursors.add(connection.page_info.end_cursor);
        for (const edge of connection.edges) {
            const node = edge?.node;
            if (!node || typeof node.friendship_status !== "string") { malformed = true; continue; }
            if (node.friendship_status !== "INCOMING_REQUEST") continue;
            const id = String(node.id ?? "");
            if (!/^[1-9]\d{0,29}$/.test(id)) { malformed = true; continue; }
            requests.set(id, { id, name: typeof node.name === "string" ? safeGraphText(node.name, session) : "", status: "INCOMING_REQUEST" });
        }
    }
    const totalCount = counts.length ? Math.max(...counts) : null;
    const hasNextPage = flags.includes(true) ? true : flags.every((flag) => flag === false) ? false : null;
    return {
        totalCount, loadedCount: requests.size, hasNextPage,
        endCursor: cursors.size === 1 ? [...cursors][0] : null,
        incomplete: hasNextPage !== false || malformed || (totalCount !== null && totalCount > requests.size),
        requests: [...requests.values()],
    };
}
