import { ensureFacebookPage } from "./runtime.js";

// Читає токен зі сторінки Ads Manager без перехоплення мережевих запитів.
export function extractFacebookAccessTokenFromHtml(html, { prefix = "EAA" } = {}) {
    const source = String(html ?? "");
    const patterns = [
        /"accessToken"\s*:\s*"(EAA[A-Za-z0-9_-]{20,})"/g,
        /\\"accessToken\\"\s*:\s*\\"(EAA[A-Za-z0-9_-]{20,})\\"/g,
        /\b(EAA[A-Za-z0-9_-]{20,})\b/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            if (match[1].startsWith(prefix)) return match[1];
        }
    }
    return "";
}

export async function readFacebookAccessToken(page) {
    try {
        await ensureFacebookPage(page, { surface: "adsManager", timeout: 60000 });
        await page.waitForFunction(
            () => document.documentElement?.innerHTML.includes("EAA"),
            { timeout: 15000 }
        );
        return extractFacebookAccessTokenFromHtml(await page.content());
    } catch {
        return "";
    }
}

// Отримує актуальні credentials лише для створення або синхронізації API-клієнта.
export async function readFacebookBrowserCredentials(page) {
    const accessToken = await readFacebookAccessToken(page);
    if (!accessToken) throw new Error("Не знайдено access token у Ads Manager");
    const [userAgent, cookies] = await Promise.all([
        page.evaluate(() => navigator.userAgent),
        page.cookies("https://www.facebook.com"),
    ]);
    if (!String(userAgent ?? "").trim() || !cookies?.length) {
        throw new Error("Не вдалося отримати cookies або user agent Facebook");
    }
    return { accessToken, userAgent: String(userAgent), cookies };
}
