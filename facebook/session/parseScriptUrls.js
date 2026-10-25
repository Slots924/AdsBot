// Читає лише зовнішні JS-ресурси Facebook, без inline-коду та даних сторінки.
export function isFacebookScriptUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname.startsWith("static.")
            && url.hostname.endsWith(".fbcdn.net") && url.pathname.startsWith("/rsrc.php/")
            && !url.username && !url.password && !url.port;
    } catch { return false; }
}

export default function parseScriptUrls(html) {
    return [...new Set([...String(html).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)]
        .map(match => match[1].replaceAll("&amp;", "&"))
        .filter(isFacebookScriptUrl))];
}
