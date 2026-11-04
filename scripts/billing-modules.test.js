import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import FacebookBillingModules from "../facebook/autoupload/encryption/FacebookBillingModules.js";
import { buildBillingPaymentSettingsUrl } from "../facebook/api/billingResources.js";
import addCreditCard from "../facebook/autoupload/actions/billing/addCreditCard.js";

const source = (name, dependencies = []) => `__d(${JSON.stringify(name)},${JSON.stringify(dependencies)},function(a,b,c,d,module){module.exports={ready:true};});`;
const resourceUrl = () => `https://static.xx.fbcdn.net/rsrc.php/v4/test/${randomUUID()}.js`;
const manifest = payload => `<script type="application/json">${JSON.stringify(payload)}</script>`;
const loaderFor = requestStaticResource => new FacebookBillingModules({ requestStaticResource }, { retryDelayMs: 0 });

test("тимчасові збої мають обмежені повтори", async () => {
    let calls = 0;
    const loader = loaderFor(async () => {
        if (++calls < 3) throw Object.assign(new Error("test timeout"), { code: "ETIMEDOUT" });
        return source("Root");
    });
    loader.initialUrls = [resourceUrl()];
    await loader.loadRoots(["Root"]);
    assert.equal(calls, 3);
    assert.equal(loader.require("Root").ready, true);
    assert.equal(loader.diagnostics.failures.length, 2);
});

test("кожна нова операція завантажує ресурси через HTTP без спільного кешу", async () => {
    let calls = 0;
    const client = { requestStaticResource: async () => { calls++; return source("Root"); } };
    const url = resourceUrl();
    for (let operation = 0; operation < 2; operation++) {
        const loader = new FacebookBillingModules(client);
        loader.initialUrls = [url];
        await loader.loadRoots(["Root"]);
        assert.equal(loader.require("Root").ready, true);
    }
    assert.equal(calls, 2);
});

test("паралельні звернення одного завантажувача об'єднуються", async () => {
    let calls = 0;
    const loader = loaderFor(async () => { calls++; return source("Root"); });
    const url = resourceUrl();
    await Promise.all([loader.download(url), loader.download(url)]);
    await loader.download(url);
    assert.equal(calls, 1);
});

test("відкладена залежність читається з карти ресурсів поточної сторінки", async () => {
    const rootUrl = resourceUrl(), dependencyUrl = resourceUrl();
    const calls = [];
    const loader = loaderFor(async url => {
        calls.push(url);
        return url === rootUrl ? source("Root", ["Dependency"]) : source("Dependency");
    });
    loader.readManifest(`<script src="${rootUrl}"></script>` + manifest({ rsrcMap: { 42: { src: dependencyUrl } }, compMap: { Dependency: { r: [42] } } }));
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Dependency").ready, true);
    assert.deepEqual(new Set(calls), new Set([rootUrl, dependencyUrl]));
    assert.deepEqual(loader.diagnostics.missingModules, []);
});

test("відсутня транзитивна залежність не дозволяє оголосити готовність", async () => {
    const loader = loaderFor(async () => source("Root", ["Middle"]) + source("Middle", ["Missing"]));
    loader.initialUrls = [resourceUrl()];
    await assert.rejects(loader.loadRoots(["Root"]), error => error.code === "BILLING_MODULE_UNAVAILABLE"
        && error.moduleName === "Missing" && error.encryptionDiagnostics.missingModules.includes("Missing"));
});

test("ресурси без іменного індексу також знаходяться в актуальному manifest", async () => {
    const url = resourceUrl();
    const loader = loaderFor(async value => { assert.equal(value, url); return source("Root"); });
    loader.readManifest(manifest({ rsrcMap: { lazy: { src: url } } }));
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Root").ready, true);
});

test("публічний JS може додати актуальну карту Bootloader", async () => {
    const rootUrl = resourceUrl(), lazyUrl = resourceUrl();
    const loader = loaderFor(async url => url === rootUrl
        ? source("Root", ["Lazy"]) + `requireLazy(["Bootloader"],function(b){b.handlePayload(${JSON.stringify({ rsrcMap: { lazy: { src: lazyUrl } }, compMap: { Lazy: { r: ["lazy"] } } })});});`
        : source("Lazy"));
    loader.initialUrls = [rootUrl];
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Lazy").ready, true);
});

test("оновлення manifest не змішує фабрики різних ревізій", async () => {
    const oldUrl = resourceUrl(), newUrl = resourceUrl();
    const loader = loaderFor(async url => url === oldUrl ? source("Root", ["OldMissing"])
        : '__d("Root",[],function(a,b,c,d,module){module.exports={version:"new"};});');
    loader.initialUrls = [oldUrl];
    let refreshes = 0;
    await loader.loadRoots(["Root"], { refreshManifest: async () => { refreshes++; return `<script src="${newUrl}"></script>`; } });
    assert.equal(refreshes, 1);
    assert.equal(loader.require("Root").version, "new");
    assert.deepEqual(loader.diagnostics.missingModules, []);
});

test("завантаження припиняється після отримання потрібного графа", async () => {
    const urls = Array.from({ length: 10 }, resourceUrl);
    let calls = 0;
    const loader = loaderFor(async () => { calls++; return source("Root"); });
    loader.initialUrls = urls;
    await loader.loadRoots(["Root"]);
    assert.equal(calls, 4);
});

test("список ресурсів не обрізається після перших ста файлів", async () => {
    const urls = Array.from({ length: 101 }, resourceUrl);
    const loader = loaderFor(async url => source(url === urls[100] ? "Root" : "Other"));
    loader.initialUrls = urls;
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Root").ready, true);
    assert.equal(loader.diagnostics.downloaded, 101);
});

test("HTML замість JS і частково виконаний ресурс не вважаються готовими", async () => {
    let calls = 0;
    const loader = loaderFor(async () => {
        calls++;
        if (calls === 1) return "<html>bad response</html>";
        if (calls === 2) return source("Root") + ';throw new Error("broken");';
        return source("Root");
    });
    loader.initialUrls = [resourceUrl()];
    await loader.loadRoots(["Root"]);
    assert.equal(calls, 3);
    assert.equal(loader.diagnostics.downloaded, 1);
});

test("сталі відмови обмежені трьома викликами ресурсу", async () => {
    let calls = 0;
    const loader = loaderFor(async () => { calls++; throw new Error("unavailable"); });
    loader.initialUrls = [resourceUrl()];
    await assert.rejects(loader.loadRoots(["Root"]), error => error.code === "BILLING_MODULE_UNAVAILABLE");
    assert.equal(calls, 3);
});

test("без актуальних ресурсів немає звернень до зашитих CDN-пакетів", async () => {
    let calls = 0;
    const loader = loaderFor(async () => { calls++; return source("Root"); });
    loader.readManifest("<html></html>");
    await assert.rejects(loader.loadRoots(["Root"]), { code: "BILLING_MODULE_UNAVAILABLE" });
    assert.equal(calls, 0);
});

test("скасування не викликає повторів завантаження", async () => {
    const controller = new AbortController();
    let calls = 0;
    const loader = new FacebookBillingModules({ requestStaticResource: async () => { calls++; controller.abort(); throw new Error("cancelled"); } },
        { signal: controller.signal, retryDelayMs: 0 });
    loader.initialUrls = [resourceUrl()];
    await assert.rejects(loader.loadRoots(["Root"]), error => error.name === "AbortError");
    assert.equal(calls, 1);
});

test("циклічні залежності не зациклюють підготовку", async () => {
    const loader = loaderFor(async () => source("Root", ["Child"]) + source("Child", ["Root"]));
    loader.initialUrls = [resourceUrl()];
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Root").ready, true);
});

test("персональний платіжний акаунт передається в URL без business_id", () => {
    const url = new URL(buildBillingPaymentSettingsUrl("act_123"));
    assert.equal(url.searchParams.get("asset_id"), "123");
    assert.equal(url.searchParams.get("payment_account_id"), "123");
    assert.equal(url.searchParams.get("placement"), "ads_manager");
    assert.equal(url.searchParams.has("business_id"), false);
    assert.throws(() => buildBillingPaymentSettingsUrl("invalid"));
});

test("платіжний екшен не надсилає GraphQL за неповного графа модулів", async () => {
    const url = resourceUrl();
    let requests = 0;
    const client = {
        request: async ({ url: address }) => {
            requests++;
            assert.equal(new URL(address).searchParams.get("payment_account_id"), "123");
            return { data: `<script src="${url}"></script>` };
        },
        requestStaticResource: async () => source("FBPayAuthLibraryCommon", ["Missing"])
            + source("FBPayAuthLibraryUtils") + source("FBPayBase64URL")
            + source("PaymentsCometGetServerEncryptionKeyMutation.graphql") + source("BillingSaveCardCredentialStateMutation.graphql")
            + source("BillingCheckRiskStateQuery.graphql"),
    };
    await assert.rejects(addCreditCard(client, { profileId: "test", adAccountId: "act_123", resources: [],
        card: { cardNumber: "4111111111111111", securityCode: "123", expiration: "12/30" } }), { code: "BILLING_MODULE_UNAVAILABLE", moduleName: "Missing" });
    assert.equal(requests, 3);
});

test("постійна HTTP-відмова не повторюється на наступних проходах", async () => {
    let calls = 0;
    const loader = loaderFor(async () => { calls++; throw Object.assign(new Error(), { httpStatus: 404 }); });
    const url = resourceUrl();
    const html = `<script src="${url}"></script>`;
    loader.readManifest(html);
    await assert.rejects(loader.loadRoots(["Root"], { refreshManifest: async () => html }), { code: "BILLING_MODULE_UNAVAILABLE" });
    assert.equal(calls, 1);
});

test("карта ресурсів не завантажує CSS як JavaScript", async () => {
    const url = resourceUrl();
    const loader = loaderFor(async value => { assert.equal(value, url); return source("Root"); });
    loader.readManifest(manifest({ rsrcMap: { style: { type: "css", src: resourceUrl() },
        css: { src: resourceUrl().replace(/\.js$/, ".css") }, js: { type: "js", src: url } } }));
    await loader.loadRoots(["Root"]);
    assert.equal(loader.diagnostics.downloaded, 1);
});

test("окремий публічний ресурс може містити лише карту Bootloader", async () => {
    const mapUrl = resourceUrl(), rootUrl = resourceUrl();
    const loader = loaderFor(async url => url === mapUrl
        ? `requireLazy(["Bootloader"],function(b){b.setResourceMap(${JSON.stringify({ root: { src: rootUrl } })});});`
        : source("Root"));
    loader.initialUrls = [mapUrl];
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Root").ready, true);
});

test("помилковий JS не залишає проміжних карт Bootloader", async () => {
    const url = resourceUrl();
    const loader = loaderFor(async () => `requireLazy(["Bootloader"],function(b){b.setResourceMap(${JSON.stringify({ wrong: { src: resourceUrl() } })});});throw new Error();`);
    assert.equal(await loader.download(url), false);
    assert.equal(loader.resourceUrls.size, 0);
});

test("відкладений load завантажує модуль до повернення експорту", async () => {
    const url = resourceUrl();
    const loader = loaderFor(async () => source("Lazy"));
    loader.readManifest(manifest({ rsrcMap: { lazy: { src: url } }, compMap: { Lazy: { r: ["lazy"] } } }));
    const deferred = loader.require("requireDeferred")("Lazy");
    assert.equal((await deferred.load()).ready, true);
});

test("діагностика графа враховує конфіги, адаптери і транзитивні прогалини без HTTP", async () => {
    const loader = loaderFor(async () => source("Root", ["Child", "Promise", "Config"])
        + source("Child", ["Missing", "Root"]));
    await loader.download(resourceUrl());
    loader.configs.set("Config", { enabled: true });
    const result = loader.inspectRoots(["Root", "OtherRoot"]);
    assert.deepEqual(result.rootStatus, [{ name: "Root", available: true }, { name: "OtherRoot", available: false }]);
    assert.deepEqual(new Set(result.missingModules), new Set(["OtherRoot", "Missing"]));
    assert.equal(result.requiredModuleCount, 6);
});

test("власний завантажувач початкового JS не замінює збирач фабрик", async () => {
    const loader = loaderFor(async () => '"use strict";globalThis.__d=function(){};globalThis.requireLazy=function(){};'
        + source("Root") + 'requireLazy(["Bootloader"],function(b){b.setResourceMap({next:{type:"js",src:"https://static.xx.fbcdn.net/rsrc.php/v4/test/next.js"}});});');
    loader.initialUrls = [resourceUrl()];
    await loader.loadRoots(["Root"]);
    assert.equal(loader.require("Root").ready, true);
    assert.equal(loader.resourceUrls.get("next"), "https://static.xx.fbcdn.net/rsrc.php/v4/test/next.js");
});

test("опис ресурсу підтверджується лише визначеннями саме цього файлу", async () => {
    const first = resourceUrl(), second = resourceUrl();
    const loader = loaderFor(async url => source(url === first ? "Expected" : "Other"));
    await loader.loadResources([{ url: first, moduleNames: ["Expected"] }]);
    await assert.rejects(loader.loadResources([{ url: second, moduleNames: ["Expected"] }]),
        error => error.code === "BILLING_RESOURCE_MODULE_MISSING" && error.missingModules.includes("Expected"));
});

test("відомий пакет знаходиться в поточній мові за іменем файлу", async () => {
    const reference = "https://static.xx.fbcdn.net/rsrc.php/v4i-test/yA/l/en_GB-j/shared.js";
    const current = reference.replace("en_GB", "en_US");
    const calls = [];
    const loader = loaderFor(async url => { calls.push(url); return source("Root"); });
    loader.readManifest(manifest({ rsrcMap: { current: { src: current } } }));
    const result = await loader.loadResourceHints([{ url: reference, moduleNames: ["Root"] }]);
    assert.equal(result[0].matchedUrl, current);
    assert.deepEqual(calls, [current]);
});

test("інший хеш локалізованого пакета перевіряється за фактичним вмістом", async () => {
    const reference = "https://static.xx.fbcdn.net/rsrc.php/v4i-test/yA/l/en_GB-j/old.js";
    const wrong = reference.replace("en_GB-j/old.js", "en_US-j/wrong.js");
    const right = reference.replace("en_GB-j/old.js", "en_US-j/new.js");
    const loader = loaderFor(async url => source(url === right ? "Root" : "Other"));
    loader.readManifest(manifest({ rsrcMap: { wrong: { src: wrong }, right: { src: right } } }));
    const result = await loader.loadResourceHints([{ url: reference, moduleNames: ["Root"] }]);
    assert.equal(result[0].matchedUrl, right);
    assert.deepEqual(result[0].checked[0].missingModules, ["Root"]);
});

test("за відсутності кандидата в manifest старий URL не завантажується", async () => {
    let calls = 0;
    const loader = loaderFor(async () => { calls++; return source("Root"); });
    loader.readManifest("<html></html>");
    const result = await loader.loadResourceHints([{ url: resourceUrl(), moduleNames: ["Root"] }]);
    assert.equal(result[0].matchedUrl, null);
    assert.equal(calls, 0);
});

test("loadRoots використовує підказку й перевіряє залежності отриманого модуля", async () => {
    const rootUrl = resourceUrl(), dependencyUrl = resourceUrl();
    const loader = loaderFor(async url => url === rootUrl ? source("Root", ["Dependency"]) : source("Dependency"));
    loader.readManifest(manifest({ rsrcMap: { root: { src: rootUrl }, dependency: { src: dependencyUrl } } }));
    await loader.loadRoots(["Root"], { resourceHints: [{ url: rootUrl, moduleNames: ["Root"] }] });
    assert.equal(loader.require("Dependency").ready, true);
});

test("відомі назви бандлів автоматично використовуються для транзитивних залежностей", async () => {
    const rootUrl = resourceUrl();
    const cardUrl = "https://static.xx.fbcdn.net/rsrc.php/v4/test/udO7ZpF3Rjb.js";
    const protectedUrl = "https://static.xx.fbcdn.net/rsrc.php/v4/test/TqiVkSsDvpF.js";
    const calls = [];
    const loader = loaderFor(async url => {
        calls.push(url);
        if (url === rootUrl) return source("Root", ["BillingCreditCardUtils"]);
        if (url === protectedUrl) return source("BillingProtectedString");
        assert.equal(url, cardUrl);
        return source("BillingCreditCardUtils", ["BillingProtectedString"])
            + source("BillingCreditCardNumber") + source("BillingCreditCardTypes");
    });
    loader.readManifest(`<script src="${rootUrl}"></script>` + manifest({ rsrcMap: {
        card: { src: cardUrl }, protected: { src: protectedUrl }, unrelated: { src: resourceUrl() },
    } }));
    await loader.loadRoots(["Root"]);
    assert.deepEqual(new Set(calls), new Set([rootUrl, cardUrl, protectedUrl]));
    assert.deepEqual(loader.inspectRoots(["Root"]).missingModules, []);
});

test("явні платіжні ресурси завантажуються знову після оновлення manifest", async () => {
    const explicit = resourceUrl(), current = resourceUrl();
    const calls = [];
    const loader = loaderFor(async url => {
        calls.push(url);
        return url === explicit ? source("Root", ["Dependency"]) : source("Dependency");
    });
    loader.readManifest("<html></html>");
    await loader.loadRoots(["Root"], { resources: [{ url: explicit, moduleNames: ["Root"] }],
        refreshManifest: async () => `<script src="${current}"></script>` });
    assert.equal(calls.filter(url => url === explicit).length, 2);
    assert.equal(loader.require("Root").ready, true);
    assert.equal(loader.require("Dependency").ready, true);
});
