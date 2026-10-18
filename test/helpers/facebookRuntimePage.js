export const testAccessToken = "EAA000000000000000000000000000000";

// Доповнює HTTP-заглушку окремим runtime, не зараховуючи його читання як мережевий запит.
export function withFacebookRuntime(page, { surface = "facebook", runtime = {} } = {}) {
    const hosts = { facebook: "www.facebook.com", adsManager: "adsmanager.facebook.com", business: "business.facebook.com" };
    let currentUrl = page.url?.() ?? `https://${hosts[surface]}/`;
    const evaluate = page.evaluate;
    return {
        ...page,
        url: () => currentUrl,
        async goto(url) { currentUrl = url; },
        async waitForFunction() {},
        async content() { return JSON.stringify({ accessToken: testAccessToken }); },
        async evaluate(callback, args) {
            if (callback.name === "readRuntimeInPage") return {
                av: runtime.av ?? runtime.__user ?? "100", __user: "100", __a: "1", fb_dtsg: "token", jazoest: "22000",
                lsd: "lsd-token", __comet_req: "15", __spin_r: "1", __spin_b: "trunk", __spin_t: "1",
                ...runtime,
            };
            return evaluate.call(this, callback, args);
        },
    };
}
