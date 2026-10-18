import assert from "node:assert/strict";
import vm from "node:vm";
import { ensureFacebookPage, readFacebookRuntime } from "../facebook/api/runtime.js";
import { readFacebookBrowserCredentials } from "../facebook/api/browserCredentials.js";
import searchCollege from "../facebook/api-actions/education/searchCollege.js";
import updateBio from "../facebook/api-actions/updateBio.js";
import confirmFacebookProfileSwitch from "../facebook/workflows/confirmFacebookProfileSwitch.js";
import getAdAccountAccessRequest from "../facebook/api-actions/ads-manager/getAdAccountAccessRequest.js";
import { buildMutationBody, postFacebookForm } from "../facebook/api/browserRequest.js";
import inviteAdditionalProfileAdmin from "../facebook/api-actions/pages/inviteAdditionalProfileAdmin.js";
import requestAdAccountAccess from "../facebook/api-actions/ads-manager/requestAdAccountAccess.js";

// Виконує справжні browser callbacks у відокремленому JS-контексті без мережі й профілів.
function createPage(url = "https://www.facebook.com/me") {
    const state = {
        url, actor: "100", account: "100", token: "first-token", lsd: "first-lsd",
        modulesAvailable: true, navigations: [], requests: [], failRequest: false,
        accessToken: "EAA000000000000000000000000000000",
    };
    const context = vm.createContext({
        URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
        window: { devicePixelRatio: 1 },
        navigator: { userAgent: "mock-user-agent" },
        document: { cookie: "c_user=100", documentElement: { innerHTML: "EAA" } },
        require(name) {
            if (!state.modulesAvailable) throw new Error("Недоступний модуль");
            const modules = {
                CurrentUserInitialData: { USER_ID: state.actor, ACCOUNT_ID: state.account },
                DTSGInitialData: { token: state.token }, DTSG: { getToken: () => state.token },
                LSD: { token: state.lsd }, DTSG_ASYNC: { getCachedToken: () => "async-token" },
                SiteData: { client_revision: 10, __spin_r: 10, __spin_b: "trunk", __spin_t: 20, comet_env: 15 },
                getAsyncParams: () => ({ av: state.actor, __user: state.actor, __csr: "current-csr" }),
            };
            if (!(name in modules)) throw new Error("Невідомий модуль");
            return modules[name];
        },
        async fetch(endpoint, options) {
            state.requests.push({ endpoint, ...options });
            if (state.failRequest) {
                const error = new Error("Завершився час запиту");
                error.name = "AbortError";
                throw error;
            }
            return { ok: true, status: 200, text: async () => JSON.stringify({ data: {
                typeahead: { fbid: "123", title: "Test College", value: "Test College" },
                saved: true,
            } }) };
        },
    });
    const page = {
        state,
        url: () => state.url,
        async goto(nextUrl) { state.url = nextUrl; state.navigations.push(nextUrl); },
        async bringToFront() {},
        async content() { return JSON.stringify({ accessToken: state.accessToken }); },
        async cookies() { return [{ name: "c_user", value: state.account }]; },
        async evaluate(callback, args) {
            context.argument = args;
            return vm.runInContext(`(${callback.toString()})(argument)`, context);
        },
        async waitForFunction(callback) {
            if (!await this.evaluate(callback)) throw new Error("Runtime не готовий");
        },
    };
    return page;
}

const page = createPage();
await ensureFacebookPage(page);
assert.equal(page.state.navigations.length, 0);
const first = await readFacebookRuntime(page);
assert.equal(first.fb_dtsg, "first-token");
assert.equal(first.__csr, "current-csr");
assert.equal(first.__spin_r, 10);
assert.equal(first.accountId, "100");
assert.equal(first.jazoest, `2${[..."first-token"].reduce((sum, character) => sum + character.charCodeAt(0), 0)}`);
page.state.token = "second-token";
page.state.lsd = "second-lsd";
assert.equal((await readFacebookRuntime(page)).fb_dtsg, "second-token");
const result = await searchCollege({ page, query: "Test College" });
assert.equal(result.success, true);
const body = new URLSearchParams(page.state.requests[0].body);
assert.equal(body.get("fb_dtsg"), "second-token");
assert.equal(page.state.requests[0].headers["x-fb-lsd"], "second-lsd");
assert.equal(page.state.requests[0].credentials, "include");
assert.equal(JSON.stringify(result).includes("second-token"), false);

// Транспорт освіжає токен навіть якщо екшин уже підготував тіло запиту.
const preparedBody = buildMutationBody(first, { friendlyName: "TestMutation", docId: "123", variables: {} });
await postFacebookForm(page, { body: preparedBody, friendlyName: "TestMutation", timeout: 1000 });
assert.equal(new URLSearchParams(page.state.requests.at(-1).body).get("fb_dtsg"), "second-token");
page.state.actor = "200";
const requestsBeforeMismatch = page.state.requests.length;
assert.equal((await postFacebookForm(page, { body: preparedBody, timeout: 1000 })).requestError, "FACEBOOK_ACTOR_CHANGED");
assert.equal(page.state.requests.length, requestsBeforeMismatch);
assert.equal((await inviteAdditionalProfileAdmin({ page, additionalProfileId: "300", targetUserId: "400" })).success, false);
assert.equal(page.state.requests.length, requestsBeforeMismatch);

const wrongDomain = createPage("https://adsmanager.facebook.com/adsmanager/manage/campaigns");
assert.equal((await searchCollege({ page: wrongDomain, query: "Test College" })).success, true);
assert.deepEqual(wrongDomain.state.navigations, ["https://www.facebook.com/"]);
await ensureFacebookPage(wrongDomain);
assert.equal(wrongDomain.state.navigations.length, 1);

const billingPage = createPage("https://adsmanager.facebook.com/other?asset_id=1");
const billingOptions = {
    surface: "adsManager", url: "https://adsmanager.facebook.com/billing?asset_id=2",
    matchPath: true, queryKeys: ["asset_id"],
};
await ensureFacebookPage(billingPage, billingOptions);
await ensureFacebookPage(billingPage, billingOptions);
assert.equal(billingPage.state.navigations.length, 1);
assert.equal(new URL(billingPage.url()).searchParams.get("asset_id"), "2");
await assert.rejects(ensureFacebookPage(billingPage, { url: "https://facebook.com.example.test/" }));

const unavailable = createPage();
unavailable.state.modulesAvailable = false;
assert.ok((await readFacebookRuntime(unavailable)).runtimeError);
assert.equal((await searchCollege({ page: unavailable, query: "Test College" })).success, false);
assert.equal(unavailable.state.requests.length, 0);
const loggedOut = createPage();
loggedOut.state.actor = "0";
assert.ok((await readFacebookRuntime(loggedOut)).runtimeError);

const switched = createPage();
switched.state.actor = "200";
const confirmation = await confirmFacebookProfileSwitch({ page: switched, targetProfileId: "200" });
assert.equal(confirmation.success, true);
assert.equal(confirmation.data.actorId, "200");
assert.equal("payload" in confirmation.data, false);
assert.equal(switched.state.navigations[0], "https://www.facebook.com/me");
assert.equal((await confirmFacebookProfileSwitch({ page: switched, targetProfileId: "300" })).status, "ACTOR_MISMATCH");

const credentialsPage = createPage();
const credentials = await readFacebookBrowserCredentials(credentialsPage);
assert.equal(credentials.accessToken, credentialsPage.state.accessToken);
assert.equal(credentials.userAgent, "mock-user-agent");
assert.equal(credentials.cookies[0].value, "100");
assert.equal(new URL(credentialsPage.url()).hostname, "adsmanager.facebook.com");

const timedOut = createPage();
timedOut.state.failRequest = true;
assert.equal((await updateBio({
    page: timedOut, collectionToken: "collection", sectionToken: "section", value: "bio",
})).status, "REQUEST_TIMEOUT");
assert.equal(timedOut.state.requests.length, 1);

const agencyPage = createPage("https://www.facebook.com/");
await getAdAccountAccessRequest({ page: agencyPage, adAccountId: "123", agencyId: "456", adMarketId: "789" });
assert.equal(new URL(agencyPage.url()).hostname, "adsmanager.facebook.com");
assert.equal(new URL(agencyPage.state.requests[0].endpoint, agencyPage.url()).searchParams.get("fb_dtsg_ag"), "async-token");

const businessPage = createPage();
await requestAdAccountAccess({ page: businessPage, businessId: "456", adAccountId: "123" });
assert.equal(new URL(businessPage.url()).hostname, "business.facebook.com");
assert.equal(new URLSearchParams(businessPage.state.requests[0].body).get("lsd"), "first-lsd");
assert.equal(new URLSearchParams(businessPage.state.requests[0].body).get("__bid"), "456");

console.log("Перевірки runtime, навігації, credentials, actor і відсутності повтору mutation пройшли успішно");
