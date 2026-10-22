import parseWebSession from "../../../facebook/session/parseWebSession.js";

const eaabPattern = /\bEAAB[A-Za-z0-9_-]{20,}\b/;
const eaaPattern = /\bEAA[A-Za-z0-9_-]{20,}\b/;

export function safeDiagnosticUrl(value) {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) return "[non-http]";
        const pathname = url.pathname.split("/").map((part) => /^\d+$/.test(part) ? "[id]" : /EAA|token|cookie|secret|@|%40/i.test(part) || part.length > 80 ? "[redacted]" : part).join("/");
        return `${url.origin}${pathname}`;
    } catch { return "[unavailable]"; }
}

// Аналіз повертає лише ознаки та назви полів. Значення токенів не виходять із пам'яті.
export default function analyzeAdsManagerHtml(body, { url, expectedUserId } = {}) {
    const html = String(body ?? "");
    const session = parseWebSession(html).session;
    const tokenCategories = new Set();
    const tokenContainers = new Set();
    const tokenContextModules = new Set();
    const tokenContextKeys = new Set();
    const scriptSources = [];
    let jsonScripts = 0;
    let bootstrapHasViewer = false;
    let visited = 0;
    const inspectJson = (root) => {
        const stack = [{ value: root, path: "$", depth: 0, module: null }];
        while (stack.length && ++visited <= 100_000) {
            const { value, path, depth, module } = stack.pop();
            if (depth > 60 || !value || typeof value !== "object") continue;
            let moduleName = module;
            if (Array.isArray(value) && typeof value[0] === "string" && /^(Ads|Business|CurrentUser|SiteData|DTSG|LSD)[A-Za-z0-9_]{0,70}$/.test(value[0])) moduleName = value[0];
            for (const [key, child] of Object.entries(value)) {
                if (key === "viewer") bootstrapHasViewer = true;
                const safeKey = /^\d+$/.test(key) ? "[]" : /^[A-Za-z_$][A-Za-z0-9_$]{0,60}$/.test(key) ? key : "[key]";
                const nextPath = `${path}.${safeKey}`;
                if (typeof child === "string" && eaabPattern.test(child) && tokenContainers.size < 12) {
                    tokenContainers.add(`${moduleName ? `${moduleName}:` : ""}${nextPath}`);
                } else if (child && typeof child === "object") stack.push({ value: child, path: nextPath, depth: depth + 1, module: moduleName });
            }
        }
    };
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const attributes = match[1];
        const script = match[2];
        const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
        if (source) {
            try {
                const address = new URL(source.replace(/&amp;/g, "&"), url);
                if (["http:", "https:"].includes(address.protocol)) scriptSources.push(safeDiagnosticUrl(address.href));
            } catch {}
        }
        const isJson = /\btype\s*=\s*["']application\/json["']/i.test(attributes);
        if (isJson) {
            jsonScripts += 1;
            try { inspectJson(JSON.parse(script)); } catch {}
        }
        if (eaabPattern.test(script)) tokenCategories.add(isJson ? "bootstrap_json" : "inline_javascript");
    }
    if (eaabPattern.test(html) && !tokenCategories.size) tokenCategories.add("html_other");
    const tokenIndex = html.search(eaabPattern);
    if (tokenIndex >= 0) {
        const context = html.slice(Math.max(0, tokenIndex - 3000), tokenIndex);
        for (const name of ["AdsPEGlobal", "AdsManagerWebInstance", "AdsManagerInitData", "BusinessUserGlobalData"]) {
            if (context.includes(name)) tokenContextModules.add(name);
        }
        const nearby = context.slice(-200);
        for (const name of ["accessToken", "access_token", "userAccessToken"]) if (nearby.includes(name)) tokenContextKeys.add(name);
    }
    let pathname = "";
    try { pathname = new URL(url).pathname; } catch {}
    const checkpoint = /\/(checkpoint|challenge|two_step_verification)(\/|$)/i.test(pathname);
    const login = /\/(login|loginpage|recover)(\/|\.|$)/i.test(pathname) || /id=["']login_form["']/i.test(html)
        || (/name=["']email["']/i.test(html) && /name=["']pass["']/i.test(html));
    return {
        eaab: eaabPattern.test(html) ? "FOUND" : "NOT_FOUND",
        anyEaa: eaaPattern.test(html) ? "FOUND" : "NOT_FOUND",
        tokenCategories: [...tokenCategories], tokenContainers: [...tokenContainers], tokenContextModules: [...tokenContextModules], tokenContextKeys: [...tokenContextKeys],
        sessionFields: Object.fromEntries(Object.entries(session).map(([key, value]) => [key, Boolean(value)])),
        actorMatches: Boolean(expectedUserId && session.FacebookID === String(expectedUserId)),
        checkpoint, login,
        bootstrap: { jsonScripts, hasViewer: bootstrapHasViewer, hasBbox: html.includes('"__bbox"'), hasModuleLoader: /Bootloader|requireLazy|ServerJS/.test(html) },
        surfaces: { adsManager: /AdsManager|AdsPEGlobal|ads_manager/.test(html), business: /BusinessManager|BusinessSuite/.test(html) },
        scriptSourceCount: scriptSources.length, scriptSources: [...new Set(scriptSources)].slice(0, 15),
    };
}
