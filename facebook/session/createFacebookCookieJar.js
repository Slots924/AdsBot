import { Cookie, CookieJar } from "tough-cookie";

// Зберігає атрибути cookies та відкидає сторонні домени.
export default function createFacebookCookieJar(cookies) {
    const jar = new CookieJar();
    for (const item of cookies ?? []) {
        const domain = String(item.domain ?? "").replace(/^\./, "").toLowerCase();
        if (domain !== "facebook.com" && !domain.endsWith(".facebook.com")) continue;
        const expires = Number(item.expirationDate ?? item.expires);
        const cookie = new Cookie({
            key: item.name, value: item.value, domain, path: item.path || "/",
            hostOnly: item.hostOnly ?? !String(item.domain).startsWith("."),
            secure: Boolean(item.secure), httpOnly: Boolean(item.httpOnly),
            ...(!item.session && expires > 0 ? { expires: new Date(expires * 1000) } : {}),
            ...(["strict", "lax", "none"].includes(item.sameSite) ? { sameSite: item.sameSite } : {}),
        });
        jar.setCookieSync(cookie, `https://${domain}${cookie.path}`, { ignoreError: true });
    }
    return jar;
}
