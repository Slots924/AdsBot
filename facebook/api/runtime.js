const surfaces = Object.freeze({
    facebook: { hosts: ["www.facebook.com", "facebook.com"], url: "https://www.facebook.com/" },
    adsManager: { hosts: ["adsmanager.facebook.com"], url: "https://adsmanager.facebook.com/adsmanager/manage/campaigns" },
    business: { hosts: ["business.facebook.com"], url: "https://business.facebook.com/latest/settings" },
    accountsCenter: { hosts: ["accountscenter.facebook.com"], url: "https://accountscenter.facebook.com/" },
});

export function getFacebookSurface(page) {
    try {
        const current = new URL(page.url());
        if (current.protocol !== "https:") return null;
        return Object.keys(surfaces).find((key) => surfaces[key].hosts.includes(current.hostname)) ?? null;
    } catch { return null; }
}

// Перевіряє фактичну адресу вкладки; шлях та параметри звіряє лише для спеціальних екранів.
export async function ensureFacebookPage(page, {
    surface = "facebook", url, matchPath = false, queryKeys = [], timeout = 30000,
} = {}) {
    if (typeof page?.evaluate !== "function" || typeof page?.url !== "function") {
        throw new Error("Не передано Puppeteer page");
    }
    const target = surfaces[surface];
    if (!target) throw new Error("Невідоме середовище Facebook");
    const destination = new URL(url ?? target.url);
    if (destination.protocol !== "https:" || !target.hosts.includes(destination.hostname)) {
        throw new Error("Адреса не відповідає потрібному середовищу Facebook");
    }
    let current;
    try { current = new URL(page.url()); } catch {}
    const matches = current?.protocol === "https:"
        && target.hosts.includes(current.hostname)
        && (!matchPath || current.pathname.replace(/\/$/, "") === destination.pathname.replace(/\/$/, ""))
        && queryKeys.every((key) => current.searchParams.get(key) === destination.searchParams.get(key));
    if (!matches) {
        await page.goto(destination.href, { waitUntil: "domcontentloaded", timeout });
    }
    // Перевіряє редиректи, зокрема перенаправлення на вхід або інший домен.
    const actual = new URL(page.url());
    if (actual.protocol !== "https:" || !target.hosts.includes(actual.hostname)
        || (matchPath && actual.pathname.replace(/\/$/, "") !== destination.pathname.replace(/\/$/, ""))
        || queryKeys.some((key) => actual.searchParams.get(key) !== destination.searchParams.get(key))) {
        throw new Error("Facebook відкрив іншу сторінку замість потрібного середовища");
    }
    await page.waitForFunction(() => {
        try {
            return Boolean(require("CurrentUserInitialData")?.USER_ID
                && require("DTSGInitialData")?.token && require("LSD")?.token);
        } catch { return false; }
    }, { timeout });
}

// Зчитує лише поточний runtime; результат живе в межах одного виклику екшина.
export async function readFacebookRuntime(page, options = {}) {
    try {
        await ensureFacebookPage(page, options);
        return await page.evaluate(async function readRuntimeInPage({ asyncDtsg }) {
            const readModule = (name) => {
                try { return require(name); } catch { return null; }
            };
            const getAsyncParams = readModule("getAsyncParams");
            const parameters = typeof getAsyncParams === "function" ? getAsyncParams("POST") : {};
            const user = readModule("CurrentUserInitialData");
            const site = readModule("SiteData") ?? {};
            const fbDtsg = readModule("DTSG")?.getToken?.()
                || readModule("DTSGInitialData")?.token;
            const lsd = readModule("LSD")?.token;
            const actorId = String(parameters.av ?? user?.USER_ID ?? "");
            const userId = String(parameters.__user ?? user?.USER_ID ?? "");
            if (!/^[1-9]\d*$/.test(actorId) || !/^[1-9]\d*$/.test(userId) || !fbDtsg || !lsd) {
                return { runtimeError: "Не вдалося прочитати авторизований Facebook runtime" };
            }
            const dtsgAsync = asyncDtsg ? readModule("DTSG_ASYNC") : null;
            const fbDtsgAg = asyncDtsg
                ? dtsgAsync?.getCachedToken?.() || await dtsgAsync?.getToken?.()
                : undefined;
            if (asyncDtsg && !fbDtsgAg) return { runtimeError: "Недоступний асинхронний токен Facebook" };
            return Object.fromEntries(Object.entries({
                ...parameters,
                accountId: String(user?.ACCOUNT_ID
                    || document.cookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] || userId),
                av: actorId,
                __user: userId,
                __a: "1",
                fb_dtsg: String(fbDtsg),
                fb_dtsg_ag: fbDtsgAg,
                lsd: String(lsd),
                jazoest: `2${[...String(fbDtsg)].reduce((sum, character) => sum + character.charCodeAt(0), 0)}`,
                __rev: parameters.__rev ?? site.client_revision,
                __spin_r: parameters.__spin_r ?? site.__spin_r,
                __spin_b: parameters.__spin_b ?? site.__spin_b,
                __spin_t: parameters.__spin_t ?? site.__spin_t,
                __comet_req: parameters.__comet_req ?? site.comet_env,
            }).filter(([, value]) => value !== undefined && value !== null));
        }, { asyncDtsg: options.asyncDtsg === true });
    } catch {
        // Не повертає сирі помилки браузера, які можуть містити службові параметри.
        return { runtimeError: "Не вдалося підготувати сторінку та прочитати Facebook runtime" };
    }
}
