import "dotenv/config";

import puppeteer from "puppeteer-core";

import AdsPower from "../../classes/AdsPower.js";
import configureFacebookAutomationWindow
    from "../../facebook/browser/configureFacebookAutomationWindow.js";
import openPageWithoutPopups from "../../facebook/actions/openPageWithoutPopups.js";
import captureGraphqlPayload from "../../facebook/api-actions/captureGraphqlPayload.js";
import ensureAdsPowerProfileReady from "../../workflows/profile/ensureAdsPowerProfileReady.js";
import ensureFacebookAccountActive from "../../workflows/profile/ensureFacebookAccountActive.js";
import ensureFacebookAccountLoggedIn from "../../workflows/profile/ensureFacebookAccountLoggedIn.js";


const profileNo = String(process.argv[2] ?? "2031").trim();
const contexts = Object.freeze([
    {
        name: "Facebook",
        url: "https://www.facebook.com/",
        graphqlUrl: "https://www.facebook.com/api/graphql/",
    },
    {
        name: "Profile access",
        url: "https://www.facebook.com/settings/?tab=profile_access",
        graphqlUrl: "https://www.facebook.com/api/graphql/",
    },
    {
        name: "Ads Manager",
        url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns",
        graphqlUrl: "https://adsmanager.facebook.com/api/graphql/",
    },
]);
const comparedFields = Object.freeze([
    "__user",
    "fb_dtsg",
    "jazoest",
    "lsd",
    "__spin_r",
    "__spin_b",
    "__spin_t",
    "__crn",
    "doc_id",
    "fb_api_req_friendly_name",
]);


// Повертає лише форму URL без значень потенційно чутливих query-параметрів.
function safeUrl(value) {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? "?…" : ""}`;
}


// Порівнює payload-и без виведення токенів, cookies, пароля або самих значень полів.
function comparePayloads(reference, payload) {
    if (!reference || !payload) {
        return { sameFields: "—", differentFields: "—" };
    }
    const same = [];
    const different = [];
    for (const field of comparedFields) {
        if (String(reference[field] ?? "") === String(payload[field] ?? "")) {
            same.push(field);
        } else {
            different.push(field);
        }
    }
    return {
        sameFields: same.join(", ") || "—",
        differentFields: different.join(", ") || "—",
    };
}


async function main() {
    if (!/^\d+$/.test(profileNo)) {
        throw new Error("Передай числовий номер AdsPower-профілю, наприклад: node scripts/manual/compareProfilePayloadContexts.js 2031");
    }

    const adsPower = new AdsPower();
    let browser;
    let profileOpened = false;

    try {
        const profile = await adsPower.getProfileByNo(profileNo);
        if (!profile || !await ensureAdsPowerProfileReady(adsPower, profile)) {
            throw new Error(`AdsPower-профіль ${profileNo} не готовий до запуску`);
        }

        const browserData = await adsPower.openProfile(profileNo, {
            browserMode: "visible",
            restoreLastOpenedTabs: false,
        });
        profileOpened = true;
        browser = await puppeteer.connect({ browserWSEndpoint: browserData.ws.puppeteer });
        const page = (await browser.pages())[0] ?? await browser.newPage();
        await configureFacebookAutomationWindow(page, { browserMode: "visible" });
        await openPageWithoutPopups(page, "https://www.facebook.com/", { timeout: 60000 });

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

        const facebookPayload = captured[0]?.result?.success ? captured[0].result.data : null;
        const table = captured.map(({ context, result, finalUrl }) => {
            const comparison = comparePayloads(facebookPayload, result.success ? result.data : null);
            return {
                context: context.name,
                page: safeUrl(finalUrl),
                captured: result.success ? "так" : "ні",
                status: result.status,
                payloadFields: result.success ? Object.keys(result.data).length : 0,
                sameAsFacebook: comparison.sameFields,
                differentFromFacebook: comparison.differentFields,
            };
        });

        console.table(table);
        console.log("Payload-и, токени, cookies, пароль та їхні значення не виводилися.");
    } finally {
        try { browser?.disconnect(); } catch {}
        if (profileOpened) {
            console.log(`Профіль ${profileNo} залишено відкритим для ручної перевірки.`);
        }
    }
}


main().catch((error) => {
    console.error("Тест порівняння payload-ів завершився помилкою:", error?.message ?? error);
    process.exitCode = 1;
});
