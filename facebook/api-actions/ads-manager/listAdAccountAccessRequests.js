import { createResult } from "../education/common.js";


// Збирає ID pending-запрошень із поточної сторінки налаштувань РК.
export default async function listAdAccountAccessRequests({ page, adAccountId }) {
    const accountId = String(adAccountId ?? "").replace(/^act_/, "");
    let hostname = "";
    try {
        hostname = new URL(page?.url?.() ?? "").hostname;
    } catch {
        // Некоректну адресу обробляємо як помилку контексту сторінки.
    }
    if (typeof page?.evaluate !== "function" || !/^\d+$/.test(accountId)
        || hostname !== "adsmanager.facebook.com") {
        return createResult(false, "INVALID_INPUT", null, {
            error: "Потрібна сторінка налаштувань РК в Ads Manager",
        });
    }
    try {
        const candidates = await page.evaluate(() => {
            const html = document.documentElement.innerHTML
                .replace(/\\\//g, "/")
                .replace(/&amp;|&#38;|&#x26;|\\u0026|\\x26/gi, "&")
                .replace(/\\"/g, '"');
            const links = html.match(/\/adaccount\/agency\/accept_reject_dialog\/\?[^"'<>\s\\]+/g) ?? [];
            return links.map((link) => {
                try {
                    const url = new URL(link, location.origin);
                    return {
                        agencyId: url.searchParams.get("agency_id"),
                        adMarketId: url.searchParams.get("ad_market_id"),
                    };
                } catch {
                    return null;
                }
            }).filter((item) => /^\d+$/.test(item?.agencyId ?? "")
                && /^\d+$/.test(item?.adMarketId ?? ""));
        });
        const unique = [...new Map(candidates.map((item) =>
            [`${item.adMarketId}:${item.agencyId}`, { adAccountId: accountId, ...item }])).values()];
        return createResult(true, "FOUND", unique);
    } catch (error) {
        return createResult(false, "ERROR", null, { error: String(error?.message ?? error) });
    }
}
