const { app, safeStorage } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
app.disableHardwareAcceleration();
const storageArgument = process.argv.find(value => value.startsWith("--storage-name="));
const storageName = storageArgument?.slice("--storage-name=".length) || "Electron";
if (!["Electron", "adsbot-frontend"].includes(storageName)) throw new Error("Невідомий контекст сховища");
app.setPath("userData", path.join(app.getPath("appData"), storageName));

// Ручний запуск через Electron потрібен лише для розшифрування карти штатним safeStorage.
app.whenReady().then(async () => {
    const root = path.resolve(__dirname, "../..");
    const load = file => import(pathToFileURL(path.join(root, file)).href);
    try {
        const profileNo = process.argv[2];
        const nickname = process.argv[3];
        if (!/^\d+$/.test(profileNo || "") || !nickname) throw Object.assign(new Error(), { code: "PROFILE_AND_CARD_REQUIRED" });
        const { default: dotenv } = await load("node_modules/dotenv/lib/main.js");
        dotenv.config({ path: path.join(root, ".env"), quiet: true });
        const { default: AdsPower } = await load("classes/AdsPower.js");
        const { default: CreditCardStore } = await load("services/personalAccounts/CreditCardStore.js");
        const { default: SessionStore } = await load("services/autoupload/AutouploadSessionStore.js");
        const { default: Manager } = await load("services/personalAccounts/PersonalAutouploadSessionManager.js");
        const { default: TaskReportManager } = await load("services/reports/TaskReportManager.js");
        const { default: createSecretStorage } = await load("frontend/electron/secretStorage.js");
        const storage = createSecretStorage(safeStorage);
        const cards = new CreditCardStore({ cardsFile: path.join(root, "data/credit-cards.json"), ...storage });
        const normalize = value => String(value).toLowerCase().replace(/\s/g, "");
        const card = (await cards.list()).find(item => normalize(item.nickname) === normalize(nickname));
        if (!card) throw Object.assign(new Error(), { code: "TEST_CARD_NOT_FOUND" });
        const privateCard = await cards.getForUse(card.id);
        console.log(JSON.stringify({ stage: "card.read", success: true,
            validNumber: /^\d{12,19}$/.test(privateCard.cardNumber),
            hasSecurityCode: Boolean(privateCard.securityCode),
            validSecurityCode: /^\d{3,4}$/.test(privateCard.securityCode),
            validExpiration: /^(0[1-9]|1[0-2])\/\d{2}$/.test(privateCard.expiration) }));
        if (process.argv.includes("--decrypt-only")) return;
        const manager = new Manager({ adsPower: new AdsPower(), creditCardStore: cards,
            sessionStore: new SessionStore({ directory: path.join(root, "data/autoupload/sessions"), ...storage }),
            reportManager: new TaskReportManager({ reportsDirectory: path.join(root, "data/reports/tasks") }),
        });
        console.log(JSON.stringify({ stage: "session", profileNo }));
        const session = await manager.start({ profileNo });
        console.log(JSON.stringify({ stage: "session.ready", accounts: session.overview.adAccounts.length }));
        let account = session.overview.adAccounts.find(item => item.accountStatus === 1 && !item.business)
            || session.overview.adAccounts.find(item => !item.business);
        const accountReportId = process.argv.find(value => value.startsWith("--account-report="))?.slice("--account-report=".length);
        if (accountReportId && process.argv.includes("--browser-modules")) {
            const report = await manager.reportManager.get(accountReportId);
            const previous = report?.resultSummary?.value;
            if (previous?.profileId !== session.profileId || previous?.actorId !== session.actorId) {
                throw Object.assign(new Error(), { code: "DIAGNOSTIC_ACCOUNT_OWNER_MISMATCH" });
            }
            // Діагностика може явно використати РК, уже підтверджений читанням цього ж профілю.
            account = previous.overview?.adAccounts?.find(item => !item.business);
            console.log(JSON.stringify({ stage: "account.from-confirmed-report", found: Boolean(account) }));
        }
        if (!account) throw Object.assign(new Error(), { code: "TEST_PERSONAL_ACCOUNT_NOT_FOUND" });
        if (process.argv.includes("--modules-only") || process.argv.includes("--browser-modules")) {
            const { default: Modules } = await load("facebook/autoupload/encryption/FacebookBillingModules.js");
            const { buildBillingPaymentSettingsUrl } = await load("facebook/api/billingResources.js");
            const client = manager.sessions.get(session.id).client;
            const url = buildBillingPaymentSettingsUrl(account.accountId || account.id);
            const result = await manager.reported("billing.modules", profileNo, async () => {
                const modules = new Modules(client);
                modules.readManifest((await client.request({ url })).data);
                const hintsPath = process.argv.find(value => value.startsWith("--resource-hints="))?.slice("--resource-hints=".length);
                let resourceHintResolution;
                if (hintsPath && process.argv.includes("--integrate-resource-hints")) {
                    const { readFile } = require("node:fs/promises");
                    const hints = JSON.parse(await readFile(path.resolve(root, hintsPath), "utf8"));
                    resourceHintResolution = await modules.loadResourceHints(hints);
                    console.log(JSON.stringify({ stage: "resource-hints.resolved", resources: resourceHintResolution }));
                } else if (hintsPath) {
                    const { readFile, writeFile } = require("node:fs/promises");
                    const hints = JSON.parse(await readFile(path.resolve(root, hintsPath), "utf8"));
                    const findings = [];
                    for (const hint of hints) {
                        const isolated = new Modules(client);
                        const currentUrls = [...new Set([...modules.initialUrls, ...modules.resourceUrls.values()])]
                            .filter(value => new URL(value).pathname.split("/").pop() === new URL(hint.url).pathname.split("/").pop());
                        let checked, failure;
                        try { checked = (await isolated.loadResources([hint]))[0]; }
                        catch (error) { failure = { code: error.code, missingModules: error.missingModules }; }
                        findings.push({ ...hint, verified: Boolean(checked), currentUrls, failure,
                            definitions: [...isolated.definitions].map(([name, value]) => ({ name, dependencies: value.dependencies })),
                            diagnostics: isolated.diagnostics });
                    }
                    await writeFile(path.join(root, `data/reports/billing-resource-hints-${profileNo}.json`), JSON.stringify(findings, null, 2));
                    console.log(JSON.stringify({ stage: "resource-hints.checked", resources: findings.map(item => ({
                        file: new URL(item.url).pathname.split("/").pop(), verified: item.verified,
                        currentUrls: item.currentUrls, failure: item.failure, definitions: item.definitions.length })) }));
                    return { hintsChecked: true, verified: findings.filter(item => item.verified).length, total: findings.length };
                }
                let roots = ["FBPayAuthLibraryCommon", "FBPayAuthLibraryUtils", "FBPayBase64URL", "PaymentsCometGetServerEncryptionKeyMutation.graphql", "BillingSaveCardCredentialStateMutation.graphql"];
                if (process.argv.includes("--browser-modules")) {
                    const { readFile } = require("node:fs/promises");
                    const source = await readFile(path.join(root, "facebook/api-actions/ads-manager/addCreditCardPaymentMethod.js"), "utf8");
                    // Список беремо з чинного браузерного екшену, щоб не підтримувати його копію.
                    const names = source.match(/const runtimeModuleNames = (\[[\s\S]*?\]);/)?.[1];
                    if (!names) throw Object.assign(new Error(), { code: "BROWSER_MODULE_LIST_REQUIRED" });
                    roots = [...new Set([...JSON.parse(names.replace(/,\s*\]/g, "]")), ...roots, "modularGeneratePTT"])];
                }
                if (process.argv.includes("--manifest-only")) {
                    const metadata = { initialResourceCount: modules.initialUrls.length, resourceCount: modules.resourceUrls.size,
                        moduleIndexCount: modules.moduleResources.size,
                        rootResources: roots.map(name => ({ name, resources: (modules.moduleResources.get(name) || [])
                            .map(id => ({ id, url: modules.resourceUrls.get(id) || null,
                                metadata: modules.resourceMetadata.get(id) || null })) })),
                        billingEntries: [...modules.moduleResources.keys()].filter(name => /Billing|Payment|PTT/.test(name)) };
                    const { writeFile } = require("node:fs/promises");
                    await writeFile(path.join(root, `data/reports/billing-module-manifest-${profileNo}.json`), JSON.stringify(metadata, null, 2));
                    if (process.argv.includes("--probe-bootstrap")) {
                        const { readFile } = require("node:fs/promises");
                        const previous = JSON.parse(await readFile(path.join(root, `data/reports/billing-module-diagnostic-${profileNo}.json`), "utf8"));
                        const findings = [];
                        for (const item of previous.resources.filter(item => !item.loaded)) {
                            if (!modules.initialUrls.includes(item.url) && ![...modules.resourceUrls.values()].includes(item.url)) continue;
                            const source = await client.requestStaticResource(item.url);
                            const definitions = [...source.matchAll(/__d\(\s*["']([^"']+)["']\s*,\s*(\[[^\]]*\])/g)]
                                .map(match => ({ name: match[1], dependencies: JSON.parse(match[2]) }));
                            findings.push({ url: item.url, bytes: Buffer.byteLength(source), definitions,
                                definesModuleLoader: /(?:function __d\b|__d\s*=)/.test(source),
                                prefix: source.slice(0, 1200) });
                        }
                        await writeFile(path.join(root, `data/reports/billing-bootstrap-probe-${profileNo}.json`), JSON.stringify(findings, null, 2));
                        return { bootstrapProbe: true, resources: findings.map(item => ({ file: new URL(item.url).pathname.split("/").pop(),
                            definitions: item.definitions.length, definesModuleLoader: item.definesModuleLoader })) };
                    }
                    if (process.argv.includes("--probe-ptt")) {
                        const urls = [...new Set((modules.moduleResources.get("modularGeneratePTT") || [])
                            .map(id => modules.resourceUrls.get(id)).filter(Boolean))];
                        for (const resourceUrl of urls) await modules.download(resourceUrl);
                        const probe = { downloaded: modules.diagnostics.downloaded, failures: modules.diagnostics.failures,
                            definitions: [...modules.definitions].map(([name, definition]) => ({ name, dependencies: definition.dependencies })) };
                        await writeFile(path.join(root, `data/reports/billing-ptt-probe-${profileNo}.json`), JSON.stringify(probe, null, 2));
                        return { manifestOnly: true, pttProbe: true, ...probe };
                    }
                    return { manifestOnly: true, ...metadata };
                }
                const originalDownload = modules.downloadResource.bind(modules);
                modules.downloadResource = async resourceUrl => {
                    const value = await originalDownload(resourceUrl);
                    if (modules.diagnostics.downloaded % 10 === 0) console.log(JSON.stringify({ stage: "modules.progress",
                        downloaded: modules.diagnostics.downloaded, definitions: modules.definitions.size,
                        failures: modules.diagnostics.failures.length }));
                    return value;
                };
                let failure;
                if (process.argv.includes("--targeted")) {
                    if (!resourceHintResolution) {
                        const { default: hints } = await load("facebook/autoupload/encryption/billingModuleHints.js");
                        resourceHintResolution = await modules.loadResourceHints(hints);
                    }
                    // Перевіряємо пакети поточної платіжної сторінки, без перебору всього Ads Manager.
                    const entrypoints = ["modularGeneratePTT", "BillingWebWizardRoot.react", "BillingAddPaymentMethodRoot.react",
                        "BillingHubPaymentSettingsView.react", "BillingAddPMPUXEPWizard.react", "BillingAddPMNUXEPWizard.react",
                        "BillingAddPMNUXEPV2Wizard.react", "BillingAddPMUPIFirstEPWizard.react"];
                    const urls = [...new Set([...roots, ...entrypoints].flatMap(name => (modules.moduleResources.get(name) || [])
                        .map(id => modules.resourceUrls.get(id))).filter(Boolean).concat(modules.initialUrls))];
                    console.log(JSON.stringify({ stage: "modules.plan", resources: urls.length }));
                    for (let offset = 0; offset < urls.length; offset += 4) {
                        await Promise.all(urls.slice(offset, offset + 4).map(resourceUrl => modules.download(resourceUrl)));
                    }
                    modules.diagnostics.missingModules = modules.inspectRoots(roots).missingModules;
                } else {
                    try { await modules.loadRoots(roots); } catch (error) { failure = error; }
                }
                const available = name => modules.definitions.has(name) || modules.configs.has(name) || modules.adapters.has(name);
                const report = { profileNo, roots, rootStatus: roots.map(name => ({ name, available: available(name) })),
                    scope: process.argv.includes("--targeted") ? "billing-entrypoints-and-initial-scripts" : "full-manifest",
                    resourceHintResolution,
                    definitions: [...modules.definitions].map(([name, value]) => ({ name, dependencies: value.dependencies })),
                    configModules: [...modules.configs.keys()], adapterModules: [...modules.adapters.keys()],
                    resources: [...modules.downloadAttempts].map(([url, attempts]) => ({ url, attempts, loaded: modules.attempted.has(url) })),
                    diagnostics: modules.diagnostics, resourceCount: modules.resourceUrls.size,
                    initialResourceCount: modules.initialUrls.length, moduleIndexCount: modules.moduleResources.size };
                const { writeFile } = require("node:fs/promises");
                await writeFile(path.join(root, `data/reports/billing-module-diagnostic-${profileNo}.json`), JSON.stringify(report, null, 2));
                console.log(JSON.stringify({ stage: "modules.summary", roots: report.rootStatus,
                    missingModules: modules.diagnostics.missingModules, downloaded: modules.diagnostics.downloaded,
                    definitions: modules.definitions.size, resources: report.resourceCount,
                    failures: modules.diagnostics.failures.length }));
                if (failure) throw failure;
                if (process.argv.includes("--targeted")) return { inspected: true,
                    downloaded: modules.diagnostics.downloaded, missingModules: modules.diagnostics.missingModules };
                return { ready: typeof modules.require("FBPayAuthLibraryCommon").createPttGeneric === "function",
                    downloaded: modules.diagnostics.downloaded, missingModules: modules.diagnostics.missingModules };
            });
            console.log(JSON.stringify({ stage: "modules.ready", ...result }));
            return;
        }
        console.log(JSON.stringify({ stage: "card.prepare" }));
        const resourcesPath = process.argv.find(value => value.startsWith("--explicit-resources="))?.slice("--explicit-resources=".length);
        const resources = resourcesPath ? JSON.parse(await require("node:fs/promises").readFile(path.resolve(root, resourcesPath), "utf8")) : undefined;
        const result = await manager.execute("payment.add", { sessionId: session.id, adAccountId: account.accountId || account.id, cardId: card.id, resources });
        console.log(JSON.stringify({ stage: "card.result", success: result.success, status: result.status,
            graphCode: result.graphCode ?? null, cardSaved: result.cardSaved, encryptionSucceeded: result.encryptionSucceeded }));
    } catch (error) {
        const { cleanHistory } = await load("services/reports/httpHistoryPolicy.js");
        console.log(JSON.stringify(cleanHistory({ stage: error.stage || "failed", code: error.code || null,
            message: error.message, graphUserMessage: error.graphUserMessage || null,
            moduleName: error.moduleName || null, errorType: error.name,
            missingModules: error.encryptionDiagnostics?.missingModules,
            graphCode: error.graphCode || null, graphSubcode: error.graphSubcode || null,
            encryptionSucceeded: error.encryptionSucceeded === true, outcomeUnknown: error.outcomeUnknown === true })).replace(/\b\d{12,19}\b/g, "[ID]"));
        process.exitCode = 1;
    } finally { app.quit(); }
});
