import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import AdsPower from "../../classes/AdsPower.js";
import normalizeProxy from "../../services/proxy/normalizeProxy.js";
import ProxyHttpClient from "../../services/proxy/ProxyHttpClient.js";
import createFacebookCookieJar from "../../facebook/session/createFacebookCookieJar.js";
import analyzeHtml, { safeDiagnosticUrl } from "../../services/autoupload/diagnostics/analyzeAdsManagerHtml.js";

config({ quiet: true });
const profileNo = process.argv.find((argument) => /^\d+$/.test(argument)) ?? "1989";
const output = path.resolve(".cache", `adsmanager-http-${profileNo}.json`);
const adsPower = new AdsPower();
const report = { profileNo, startedAt: new Date().toISOString(), http: [], browser: null, secretsSaved: false };
const allowed = (url) => url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) && !url.username && !url.password && (!url.port || url.port === "443");
const errorCode = (error) => /^[A-Z0-9_]{1,60}$/.test(String(error?.code ?? "")) ? error.code : "DIAGNOSTIC_FAILED";
const progress = (message) => console.log(message);

async function inspectHttp(startUrl, { http, jar, userAgent, expectedUserId }) {
    const redirects = [];
    const seen = new Set();
    let target = new URL(startUrl);
    for (let step = 0; step < 8; step += 1) {
        if (!allowed(target)) return { requestedUrl: safeDiagnosticUrl(startUrl), redirects, outcome: "EXTERNAL_REDIRECT_STOPPED", finalUrl: safeDiagnosticUrl(target.href) };
        if (seen.has(target.href)) return { requestedUrl: safeDiagnosticUrl(startUrl), redirects, outcome: "REDIRECT_LOOP" };
        seen.add(target.href);
        let response;
        try {
            response = await http.request({ method: "get", url: target.href, maxRedirects: 0, timeout: 30000, responseType: "text",
                maxContentLength: 20 * 1024 * 1024, validateStatus: () => true,
                headers: { Cookie: jar.getCookieStringSync(target.href), "User-Agent": userAgent,
                    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9",
                    "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none", "Sec-Fetch-User": "?1", "Upgrade-Insecure-Requests": "1" },
            }, { retryOnConnectionError: false });
        } catch (error) { return { requestedUrl: safeDiagnosticUrl(startUrl), redirects, outcome: "NETWORK_ERROR", errorCode: errorCode(error), finalUrl: safeDiagnosticUrl(target.href) }; }
        const updates = response.headers?.["set-cookie"] ?? [];
        for (const cookie of typeof updates === "string" ? [updates] : updates) jar.setCookieSync(cookie, target.href, { ignoreError: true });
        const contentType = String(response.headers?.["content-type"] ?? "").split(";")[0];
        const html = String(response.data ?? "");
        const analysis = analyzeHtml(html, { url: target.href, expectedUserId });
        const item = { url: safeDiagnosticUrl(target.href), queryParameterNames: [...target.searchParams.keys()].filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,50}$/.test(key)), status: response.status, contentType, bytes: Buffer.byteLength(html), analysis };
        redirects.push(item);
        if (analysis.checkpoint || [403, 429].includes(response.status)) return { requestedUrl: safeDiagnosticUrl(startUrl), redirects, finalUrl: item.url, status: item.status, outcome: analysis.checkpoint ? "CHECKPOINT" : `HTTP_${response.status}`, analysis };
        if ([301, 302, 303, 307, 308].includes(response.status) && response.headers?.location) {
            target = new URL(response.headers.location, target);
            continue;
        }
        const outcome = analysis.login ? "LOGIN" : response.status < 200 || response.status >= 300 ? "HTTP_ERROR" : analysis.actorMatches ? "AUTHORIZED_ACTOR_CONFIRMED" : "AUTHORIZATION_UNCONFIRMED";
        return { requestedUrl: safeDiagnosticUrl(startUrl), redirects, finalUrl: item.url, status: item.status, outcome, analysis };
    }
    return { requestedUrl: safeDiagnosticUrl(startUrl), redirects, outcome: "REDIRECT_LIMIT" };
}

async function inspectBrowser(profile, expectedUserId) {
    const result = { responses: [], requestFailures: [], documents: [], runtimeDom: null, assetsUiMarkers: {}, errors: [] };
    let browser;
    let page;
    let openedHere = false;
    let session;
    const pending = new Set();
    try {
        const active = await adsPower.getCloudProfileStatus([profile.profile_id]);
        const wasOpen = active.some((entry) => String(entry.user_id) === String(profile.profile_id));
        const connection = await adsPower.openProfile(profileNo, { browserMode: "visible", restoreLastOpenedTabs: true, proxyDetection: false });
        openedHere = !wasOpen;
        browser = await puppeteer.connect({ browserWSEndpoint: connection.ws.puppeteer, defaultViewport: null });
        page = await browser.newPage();
        session = await page.createCDPSession();
        await session.send("Network.enable", { maxTotalBufferSize: 40 * 1024 * 1024, maxResourceBufferSize: 20 * 1024 * 1024 });
        const requests = new Map();
        const responses = new Map();
        const started = Date.now();
        session.on("Network.requestWillBeSent", (event) => {
            if (requests.size > 2500) return;
            let address;
            try { address = new URL(event.request.url); } catch { return; }
            if (!(address.hostname === "facebook.com" || address.hostname.endsWith(".facebook.com") || address.hostname.endsWith(".fbcdn.net"))) return;
            requests.set(event.requestId, {
                method: event.request.method, url: safeDiagnosticUrl(event.request.url), type: event.type,
                initiator: { type: event.initiator?.type ?? null, script: event.initiator?.stack?.callFrames?.[0]?.url ? safeDiagnosticUrl(event.initiator.stack.callFrames[0].url) : null },
                timeMs: Date.now() - started,
            });
        });
        session.on("Network.responseReceived", (event) => {
            const request = requests.get(event.requestId);
            if (!request || !["Document", "Fetch", "XHR", "Script"].includes(event.type)) return;
            const entry = { ...request, status: event.response.status, contentType: event.response.mimeType, eaab: "NOT_INSPECTED" };
            result.responses.push(entry);
            responses.set(event.requestId, entry);
        });
        session.on("Network.loadingFailed", (event) => {
            const request = requests.get(event.requestId);
            if (request && result.requestFailures.length < 100) result.requestFailures.push({ ...request, blockedReason: event.blockedReason ?? null, cancelled: event.canceled === true });
        });
        session.on("Network.loadingFinished", (event) => {
            const entry = responses.get(event.requestId);
            if (!entry || !["Document", "Fetch", "XHR"].includes(entry.type) || event.encodedDataLength > 20 * 1024 * 1024) return;
            const operation = (async () => {
                try {
                    const body = await session.send("Network.getResponseBody", { requestId: event.requestId });
                    const text = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
                    const analysis = analyzeHtml(text, { url: entry.url, expectedUserId });
                    entry.eaab = analysis.eaab;
                    entry.bytes = Buffer.byteLength(text);
                    if (entry.type === "Document") result.documents.push({ url: entry.url, status: entry.status, analysis });
                } catch { entry.bodyUnavailable = true; }
            })();
            pending.add(operation);
            operation.finally(() => pending.delete(operation));
        });
        try { await page.goto("https://adsmanager.facebook.com/adsmanager/manage/campaigns", { waitUntil: "domcontentloaded", timeout: 60000 }); }
        catch (error) { result.errors.push({ stage: "navigation", code: errorCode(error) }); }
        try { await page.waitForNetworkIdle({ idleTime: 1500, timeout: 20000 }); } catch {}
        await Promise.allSettled([...pending]);
        result.finalUrl = safeDiagnosticUrl(page.url());
        result.runtimeDom = analyzeHtml(await page.content(), { url: page.url(), expectedUserId });
        result.assetsUiMarkers = await page.evaluate(() => ({
            campaignTable: Boolean(document.querySelector('[role="grid"], [role="table"], table')),
            adAccountSelector: Boolean(document.querySelector('[data-testid*="account_selector"], [aria-controls*="account"]')),
            navigation: Boolean(document.querySelector('[role="navigation"]')),
        }));
    } catch (error) { result.errors.push({ stage: "browser", code: errorCode(error) }); }
    finally {
        try { await session?.detach(); } catch {}
        try { await page?.close(); } catch {}
        try { await browser?.disconnect(); } catch {}
        if (openedHere) { try { await adsPower.closeProfile(profileNo); } catch { result.errors.push({ stage: "cleanup", code: "PROFILE_CLOSE_FAILED" }); } }
    }
    return result;
}

try {
    const profile = await adsPower.getProfileByNo(profileNo);
    let proxyConfig = profile.user_proxy_config;
    if ((!proxyConfig?.proxy_host || !proxyConfig?.proxy_port) && profile.fbcc_proxy_acc_id) proxyConfig = await adsPower.getProxyById(profile.fbcc_proxy_acc_id);
    const proxy = { ...normalizeProxy(proxyConfig), id: "adsmanager-diagnostic" };
    const cookies = await adsPower.getProfileCookies(profile.profile_id);
    const userAgent = await adsPower.getProfileUserAgent(profile.profile_id);
    const jar = createFacebookCookieJar(cookies);
    const expectedUserId = jar.getCookiesSync("https://www.facebook.com/").find((cookie) => cookie.key === "c_user")?.value;
    const context = { http: new ProxyHttpClient({ proxies: [proxy] }), jar, userAgent, expectedUserId };
    report.sessionAvailable = Boolean(expectedUserId && jar.getCookiesSync("https://www.facebook.com/").some((cookie) => cookie.key === "xs"));
    report.cookieIsolation = process.argv.includes("--cold") ? "per-target-original-cookies" : "shared-http-session";
    for (const url of ["https://www.facebook.com/", "https://adsmanager.facebook.com/", "https://business.facebook.com/"]) {
        progress(`HTTP: ${safeDiagnosticUrl(url)}`);
        const result = await inspectHttp(url, { ...context, ...(process.argv.includes("--cold") ? { jar: createFacebookCookieJar(cookies) } : {}) });
        report.http.push(result);
        progress(JSON.stringify({ url: result.requestedUrl, status: result.status, outcome: result.outcome, eaab: result.analysis?.eaab ?? "NOT_FOUND" }));
    }
    const ads = report.http[1];
    if (process.argv.includes("--manage")) {
        const result = await inspectHttp("https://adsmanager.facebook.com/adsmanager/manage/campaigns", { ...context, ...(process.argv.includes("--cold") ? { jar: createFacebookCookieJar(cookies) } : {}) });
        report.http.push(result);
        progress(JSON.stringify({ url: result.requestedUrl, status: result.status, outcome: result.outcome, eaab: result.analysis?.eaab ?? "NOT_FOUND" }));
    }
    if (!process.argv.includes("--http-only") && (process.argv.includes("--browser") || ads.analysis?.eaab !== "FOUND" || ads.outcome !== "AUTHORIZED_ACTOR_CONFIRMED")) {
        progress("Порівняння з браузером AdsPower");
        report.browser = await inspectBrowser(profile, expectedUserId);
    }
} catch (error) { report.error = { code: errorCode(error) }; process.exitCode = 1; }
finally {
    report.finishedAt = new Date().toISOString();
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2), "utf8");
    progress(`Безпечний звіт: .cache/adsmanager-http-${profileNo}.json`);
}
