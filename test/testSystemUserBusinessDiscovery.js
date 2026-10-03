import assert from "node:assert/strict";
import FacebookGraphApi from "../facebook/api/FacebookGraphApi.js";
import BusinessManagerService from "../services/gui/BusinessManagerService.js";

function mockGraph(routes, options = {}) {
    const calls = [];
    const client = new FacebookGraphApi({ kind: "system", accountKey: "system-mock", accessToken: "mock", userAgent: "UA", ...options, proxyHttpClient: {
        request: async (config) => {
            assert.equal(config.method, "get");
            assert.equal(config.headers.Authorization, "Bearer mock");
            assert.equal(Object.hasOwn(config.headers, "Cookie"), Boolean(String(options.cookie ?? "").trim()));
            if (String(options.cookie ?? "").trim()) assert.equal(config.headers.Cookie, options.cookie);
            const endpoint = new URL(config.url).pathname.replace("/v26.0", "");
            calls.push(endpoint);
            const result = routes[endpoint];
            if (result instanceof Error) throw result;
            return { data: result ?? { data: [] } };
        },
    } });
    return { client, calls };
}

// Кешований БМ перевіряється токеном системного користувача без інших клієнтів.
const cached = mockGraph({ "/me": { id: "99" }, "/1/system_users": { data: [{ id: "99" }] }, "/1": { id: "1", name: "Own" } });
assert.equal((await cached.client.getSystemUserBusinessManagers({ knownBusinessIds: ["1"] }))[0].id, "1");
assert.deepEqual(cached.calls, ["/me", "/1/system_users", "/1"]);

// Спільні методи передають Cookie тільки для клієнтів із непорожнім значенням.
await mockGraph({ "/me": { id: "99" } }, { cookie: "   " }).client.getMe();
await mockGraph({ "/me": { id: "99" } }, { kind: "bm", cookie: "c_user=99" }).client.getMe();

// Неактуальний кеш не заважає визначенню через застосунок.
const application = mockGraph({
    "/me": { id: "99" }, "/debug_token": { data: { app_id: "8", type: "SYSTEM_USER" } },
    "/8": { id: "8", business: { id: "1" } },
    "/1/system_users": { data: [{ id: "99" }] }, "/1": { id: "1", name: "Own" },
});
assert.equal((await application.client.getSystemUserBusinessManagers({ knownBusinessIds: ["2"] }))[0].id, "1");
assert.equal(application.calls.filter((item) => item === "/2/system_users").length, 1);

// Власник пошареного РК не стає власним БМ без підтвердження членства.
const assets = mockGraph({
    "/me": { id: "99" }, "/99/assigned_ad_accounts": { data: [{ business: { id: "2" } }, { business: { id: "1" } }] },
    "/2/system_users": { data: [{ id: "55" }] }, "/1/system_users": { data: [{ id: "99" }] }, "/1": { id: "1" },
});
assert.equal((await assets.client.getBusinessManagers())[0].id, "1");
assert.equal(assets.calls.includes("/me/businesses"), false);
assert.equal(assets.calls.includes("/2"), false);
const absent = mockGraph({ "/me": { id: "99" } });
await assert.rejects(absent.client.getBusinessManagers(), { code: "SYSTEM_USER_BUSINESS_NOT_DISCOVERED" });

// Фанки всього БМ повертаються незалежно від призначень та старого локального вибору.
const pages = mockGraph({
    "/me": { id: "99" },
    "/1/owned_pages": { data: [{ id: "21", name: "Available" }, { id: "22", name: "Unavailable" }] },
    "/1/client_pages": { data: [{ id: "23", name: "Shared" }] },
    "/99/assigned_pages": { data: [{ id: "21" }, { id: "23" }, { id: "24" }] },
});
assert.deepEqual((await pages.client.getBusinessManagementSection("1", "pages")).pages.map((page) => page.id), ["23", "21", "22"]);
assert.equal(pages.calls.includes("/99/assigned_pages"), false);
pages.calls.length = 0;
assert.deepEqual((await pages.client.getBusinessManagementSection("1", "users", { selectedPageIds: [] })).pages.map((page) => page.id), ["23", "21", "22"]);
assert.equal(pages.calls.includes("/22/assigned_users"), true);
assert.equal(pages.calls.includes("/23/assigned_users"), true);
assert.equal(pages.calls.includes("/99/assigned_pages"), false);

// Кандидатів отримує БМ-клієнт, остаточну перевірку виконує системний токен.
const memory = new Map(), discoveryCalls = [], created = [];
const system = { getSystemUserBusinessManagers: async ({ knownBusinessIds }) => {
    discoveryCalls.push(knownBusinessIds);
    if (!knownBusinessIds.includes("1")) throw Object.assign(new Error("not discovered"), { code: "SYSTEM_USER_BUSINESS_NOT_DISCOVERED" });
    return [{ id: "1", name: "Own" }];
} };
const service = new BusinessManagerService({
    cache: { getBusinessData: async (key) => memory.get(key), setBusinessData: async (key, value) => memory.set(key, { value }) },
    listAccounts: async () => [{ accountKey: "system", kind: "system" }, { accountKey: "bm", kind: "bm" }, { accountKey: "archived", kind: "bm", archived: true }],
    createClient: async (key) => { created.push(key); return key === "system" ? system : { getBusinessManagers: async () => [{ id: "1" }, { id: "2" }] }; },
});
assert.equal((await service.execute({ action: "list", accountKey: "system", force: true })).value[0].id, "1");
assert.deepEqual(discoveryCalls, [[], ["1", "2"]]);
assert.deepEqual(created, ["system", "bm"]);
created.length = 0;
await service.execute({ action: "list", accountKey: "system", force: true });
assert.deepEqual(created, ["system"]);
assert.deepEqual(discoveryCalls.at(-1), ["1"]);
created.length = 0;
await service.execute({ action: "list", accountKey: "system" });
assert.equal(created.length, 0);

// Старий кеш та локальний вибір не звужують дані БМ.
system.kind = "system";
system.getBusinessManagementSection = async (_business, section) => section === "pages"
    ? { pages: [{ id: "21", name: "First" }, { id: "23", name: "Second" }] }
    : { users: [], pages: [{ id: "21", assignedUsers: [] }, { id: "23", assignedUsers: [] }], adAccounts: [] };
const pagesInput = { accountKey: "system", businessId: "1", section: "pages" };
memory.set(JSON.stringify(["system", "1", "pages"]), { value: { pages: [] } });
memory.set(service.key("system", "1", "pageSelection"), { value: [] });
assert.equal(await service.execute({ ...pagesInput, action: "section" }), undefined);
assert.deepEqual((await service.execute({ ...pagesInput, action: "section", force: true })).value.pages.map((page) => page.id), ["21", "23"]);
assert.deepEqual((await service.execute({ ...pagesInput, action: "section" })).value.pages.map((page) => page.id), ["21", "23"]);
assert.deepEqual((await service.execute({ ...pagesInput, section: "users", action: "section", force: true })).value.pages.map((page) => page.id), ["21", "23"]);
await assert.rejects(service.execute({ ...pagesInput, action: "selectPages", selectedIds: [] }), /Невідома операція/);
created.length = 0;

// Невалідний токен не маскується пошуком кандидатів через інших клієнтів.
system.getSystemUserBusinessManagers = async () => { throw Object.assign(new Error("expired"), { code: "FACEBOOK_API_ERROR", graphCode: 190 }); };
await assert.rejects(service.execute({ action: "list", accountKey: "system", force: true }), { graphCode: 190 });
assert.deepEqual(created, ["system"]);
console.log("Перевірки визначення власного БМ системного користувача пройшли");
