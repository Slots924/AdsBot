import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import captureGraphqlPayload from "../../facebook/api-actions/captureGraphqlPayload.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const profileNo = String(process.argv[2] ?? "258").trim();
const contexts = Object.freeze([
    {
        name: "Business ad account settings",
        url: "https://business.facebook.com/latest/settings/ad_accounts/?business_id=703191138787237&selected_asset_id=120250251488120224&selected_asset_type=ad-account",
        graphqlUrl: "https://business.facebook.com/api/graphql/",
    },
    {
        name: "Facebook profile",
        url: "https://www.facebook.com/profile.php?id=61594039212572",
        graphqlUrl: "https://www.facebook.com/api/graphql/",
    },
    {
        name: "Ads Manager campaigns",
        url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=2658195981214921",
        graphqlUrl: "https://adsmanager.facebook.com/api/graphql/",
    },
]);


function safeUrl(value) {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
}


function comparePayloads(reference, payload) {
    if (!reference || !payload) {
        return { same: "—", different: "—", missing: "—" };
    }

    const fields = [...new Set([...Object.keys(reference), ...Object.keys(payload)])].sort();
    const same = [];
    const different = [];
    const missing = [];

    for (const field of fields) {
        const hasReference = Object.hasOwn(reference, field);
        const hasPayload = Object.hasOwn(payload, field);
        if (!hasReference || !hasPayload) {
            missing.push(field);
        } else if (String(reference[field]) === String(payload[field])) {
            same.push(field);
        } else {
            different.push(field);
        }
    }

    return {
        same: same.length ? same.join(", ") : "—",
        different: different.length ? different.join(", ") : "—",
        missing: missing.length ? missing.join(", ") : "—",
    };
}


async function main() {
    if (!/^\d+$/.test(profileNo)) {
        throw new Error("Вкажіть числовий номер AdsPower-профілю, наприклад: node scripts/manual/compareProfilePayloadContexts.js 258");
    }

    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile || !await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error(`AdsPower-профіль ${profileNo} не знайдено або він не готовий`);
        }

        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
            restoreLastOpenedTabs: false,
        });
        profileOpened = true;
        browser = await puppeteer.connect({ browserWSEndpoint: browserData.ws.puppeteer });
        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode: "visible" });

        await page.goto("https://www.facebook.com/", {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        if (!await ensureFacebookAccountLoggedIn(adsPower, profile, page)) {
            throw new Error("Facebook-вхід не підтверджено");
        }
        if (!await ensureFacebookAccountActive(adsPower, profile, page)) {
            throw new Error("Facebook-акаунт неактивний");
        }

        const captured = [];
        for (const context of contexts) {
            const result = await captureGraphqlPayload(page, {
                profileUrl: context.url,
                graphqlUrl: context.graphqlUrl,
                timeout: 60000,
            });
            captured.push({ context, result, finalUrl: page.url() });
        }

        const reference = captured[0]?.result?.success ? captured[0].result.data : null;
        const table = captured.map(({ context, result, finalUrl }, index) => {
            const comparison = index === 0
                ? { same: "Еталон", different: "—", missing: "—" }
                : comparePayloads(reference, result.success ? result.data : null);
            return {
                Сторінка: context.name,
                URL: safeUrl(finalUrl),
                Зібрано: result.success ? "так" : "ні",
                Полів: result.success ? Object.keys(result.data).length : 0,
                "Однакові з Business": comparison.same,
                "Відмінні значення": comparison.different,
                "Відсутні поля": comparison.missing,
            };
        });

        console.table(table);
        console.log("Значення payload, cookies та токени не виводилися. Поля порівняні з Business ad account settings.");
    } finally {
        try { browser?.disconnect(); } catch {}
        if (profileOpened) {
            console.log(`Профіль ${profileNo} залишено відкритим для ручної перевірки.`);
        }
    }
}


main().catch((error) => {
    console.error("Порівняння payload завершилося помилкою:", error?.message ?? error);
    process.exitCode = 1;
});
