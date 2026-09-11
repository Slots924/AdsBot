import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { appPaths } from "./paths.js";
import checkProxy from "../../services/proxy/checkProxy.js";
import refreshProxyIp from "../../services/proxy/refreshProxyIp.js";


function safeMessage(value) {
    return String(value || "Невідома помилка")
        .replace(/EAA[A-Za-z0-9_-]+/g, "[REDACTED]")
        .replace(/((?:access_)?token|cookie|authorization|password|secret|api[_-]?key|utm)=([^&\s]+)/gi, "$1=[REDACTED]")
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
}


function serializeError(error) {
    return {
        message: safeMessage(error?.message),
        code: error?.code ?? null,
        httpStatus: error?.httpStatus ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
        graphUserTitle: error?.graphUserTitle ?? null,
        graphUserMessage: error?.graphUserMessage ?? null,
        stage: error?.stage ?? null,
        itemIndex: error?.itemIndex ?? null,
        createdObjects: error?.createdObjects ?? null,
        jobId: error?.jobId ?? null,
    };
}


const markdownReportPattern = /^(commenting-report|comment-account-setup-report)_.+\.md$/i;


function markdownReportType(fileName) {
    return fileName.startsWith("commenting-report_") ? "comments" : "account-setup";
}


function markdownReportTitle(type) {
    return type === "comments"
        ? "Коментарі"
        : "Оформлення акаунтів";
}


function markdownReportFileName(value) {
    const fileName = path.basename(String(value ?? ""));
    if (!markdownReportPattern.test(fileName)) {
        const error = new Error("Некоректний файл звіту");
        error.code = "MARKDOWN_REPORT_INVALID";
        throw error;
    }
    return fileName;
}


async function resolveWorkerProxies(proxyManager, proxyIdsByWorker = {}) {
    const result = {};
    for (const [workerId, proxyId] of Object.entries(proxyIdsByWorker ?? {})) {
        const id = Number(workerId);
        if (!Number.isInteger(id) || id < 1 || id > 5) continue;
        try {
            const proxy = await proxyManager.getById(proxyId);
            if (String(proxy?.type ?? "").toLowerCase() === "no_proxy") continue;
            result[id] = proxy;
        } catch {
            // Проксі вже немає — такого воркера для коментування теж немає
        }
    }
    return result;
}


function createProxyUnavailableHandler({
    proxyManager,
    progress,
    waitForAction,
}) {
    let alerts = [];
    return async ({ workerId, commentId, proxy }) => {
        const alert = {
            workerId,
            commentId,
            proxyId: proxy?.id ?? null,
            proxyName: proxy?.name || proxy?.id || "",
            message: `Воркер ${workerId}: проксі не працює`,
        };
        alerts = [...alerts.filter((item) => item.workerId !== workerId), alert];
        await progress({
            message: alert.message,
            workerProxyAlerts: alerts,
        });
        try {
            const action = await waitForAction(`comment-proxy:${workerId}`);
            if (action?.type === "replace" && action.proxyId) {
                const next = await proxyManager.getById(action.proxyId);
                return { type: "replace", proxy: next };
            }
            return { type: "skip" };
        } finally {
            alerts = alerts.filter((item) => item.workerId !== workerId);
            await progress({ workerProxyAlerts: alerts });
        }
    };
}


function createSafeHandler(handler, logger = null) {
    return async (event, payload) => {
        try {
            return {
                ok: true,
                data: await handler(payload ?? {}, event),
            };
        } catch (error) {
            logger?.error("ipc.request.failed", "IPC-запит завершився помилкою", {
                error,
            });
            return {
                ok: false,
                error: serializeError(error),
            };
        }
    };
}


export default function registerIpcHandlers({
    ipcMain,
    dialog,
    shell,
    guiService,
    templateManager,
    appStateStore,
    adAccountPreferencesStore,
    pagePreferencesStore,
    remoteDataCacheStore,
    creativeLaunchJournal,
    countryCatalog,
    languageCatalog,
    campaignCreationJournal,
    backgroundTaskManager,
    facebookAccountManager,
    proxyManager,
    checkProxyFn = checkProxy,
    refreshProxyIpFn = refreshProxyIp,
    logger,
    reportManager,
        keitaroGuiService,
        keitaroStreamTemplateManager,
        keitaroCampaignSettingsManager,
        spendService,
        spendTaskCoordinator,
        spendScheduler,
    getWindow,
}) {
    const safeHandler = (handler) => createSafeHandler(handler, logger?.child("ipc"));
    const workspaceRefreshes = new Map();
    const campaignStatisticsRefreshIntervalMs = 10 * 60_000;
    const manualRefreshIntervalMs = 5_000;
    const adAccountRefreshTimes = new Map();
    const adAccountRefreshResults = new Map();
    const campaignRefreshTimes = new Map();
    let adsPowerStateRefresh = null;
    const sendRendererEvent = (channel, payload) => {
        const window = getWindow();
        if (window && !window.isDestroyed?.()) {
            window.webContents.send(channel, payload);
        }
    };
    const updateCacheSafely = async (operation, event = null) => {
        try {
            await operation();
            if (event) sendRendererEvent(event.channel, event.payload);
        } catch (error) {
            logger?.warn(
                "cache.update-failed",
                "Не вдалося оновити локальний кеш",
                { error }
            );
        }
    };

    const loadRemoteWorkspace = async (accountKey) => {
        const [accounts, pages] = await Promise.all([
            guiService.getAdAccounts(accountKey),
            guiService.getFanPages(accountKey, { force: true }),
        ]);
        const workspace = {
            adAccounts: await adAccountPreferencesStore.enrichAccounts(
                accountKey,
                accounts
            ),
            pages: await pagePreferencesStore.enrich(pages),
        };
        await remoteDataCacheStore.setWorkspace(accountKey, workspace);
        const cached = await remoteDataCacheStore.getWorkspace(accountKey);
        return enrichCachedWorkspace(accountKey, cached?.value ?? workspace);
    };

    const enrichCachedWorkspace = async (accountKey, workspace) => ({
        adAccounts: await adAccountPreferencesStore.enrichAccounts(
            accountKey,
            workspace?.adAccounts ?? []
        ),
        pages: await pagePreferencesStore.enrich(workspace?.pages ?? []),
    });

    const refreshWorkspaceOnce = (accountKey) => {
        if (workspaceRefreshes.has(accountKey)) {
            return workspaceRefreshes.get(accountKey);
        }
        const refresh = loadRemoteWorkspace(accountKey)
            .then((workspace) => {
                sendRendererEvent("workspace:refreshed", {
                    accountKey,
                    workspace,
                });
                return workspace;
            })
            .catch((error) => {
                logger?.warn(
                    "cache.workspace.refresh-failed",
                    `Не вдалося фоново оновити дані ${accountKey}`,
                    { error }
                );
                return null;
            });
        workspaceRefreshes.set(accountKey, refresh);
        return refresh;
    };

    const mergeCampaignStatistics = (campaigns, cachedCampaigns = []) => {
        const cachedById = new Map(cachedCampaigns.map((campaign) => [
            String(campaign.id),
            campaign,
        ]));
        return campaigns.map((campaign) => {
            const cached = cachedById.get(String(campaign.id));
            if (!cached) return campaign;
            const {
                leads,
                spend,
                costPerLead,
                impressions,
                clicks,
                cpm,
                ctr,
                metaLeads,
                leadSource,
                leadSyncStatus,
            } = cached;
            return {
                ...campaign,
                leads,
                spend,
                costPerLead,
                impressions,
                clicks,
                cpm,
                ctr,
                metaLeads,
                leadSource,
                leadSyncStatus,
            };
        });
    };

    const shouldRefreshCampaignStatistics = (updatedAt) => {
        const timestamp = Date.parse(updatedAt ?? "");
        return !Number.isFinite(timestamp)
            || Date.now() - timestamp >= campaignStatisticsRefreshIntervalMs;
    };

    const loadRemoteCampaigns = async ({
        accountKey,
        adAccountId,
        datePreset,
        refreshKeitaro = true,
    }) => {
        const cached = await remoteDataCacheStore.getCampaigns(
            accountKey,
            adAccountId,
            datePreset
        );
        const campaignList = await guiService.getAdCampaignList(
            accountKey,
            adAccountId
        );
        const previous = cached?.value;
        const data = {
            adAccountId,
            datePreset,
            campaigns: mergeCampaignStatistics(
                campaignList,
                previous?.campaigns
            ),
            statisticsUpdatedAt: previous?.statisticsUpdatedAt ?? null,
        };
        const keitaroLeadSyncEnabled = await adAccountPreferencesStore
            .isKeitaroLeadSyncEnabled(adAccountId);
        const enriched = {
            ...data,
            campaigns: await adAccountPreferencesStore.enrichCampaigns(
                adAccountId,
                data.campaigns
            ),
            cacheHit: true,
        };
        if (keitaroLeadSyncEnabled && datePreset === "today") {
            enriched.campaigns = enriched.campaigns.map((campaign) => ({
                ...campaign,
                metaLeads: campaign.leads,
                leads: null,
                costPerLead: null,
                leadSource: "keitaro",
                leadSyncStatus: "loading",
            }));
        }
        await remoteDataCacheStore.setCampaigns(
            accountKey,
            adAccountId,
            datePreset,
            enriched
        );
        if (refreshKeitaro && keitaroLeadSyncEnabled && datePreset === "today") {
            refreshKeitaroCampaignLeadsOnce({
                accountKey,
                adAccountId,
                datePreset,
                data: enriched,
            });
        }
        return enriched;
    };

    const keitaroLeadRefreshes = new Map();
    const refreshKeitaroCampaignLeadsOnce = ({
        accountKey,
        adAccountId,
        datePreset,
        data,
    }) => {
        const key = [accountKey, adAccountId, datePreset].join("::");
        if (keitaroLeadRefreshes.has(key)) return keitaroLeadRefreshes.get(key);
        const refresh = (async () => {
            try {
                if (!keitaroGuiService) throw Object.assign(
                    new Error("Сервіс Keitaro не підключено"),
                    { code: "KEITARO_UNAVAILABLE" }
                );
                const rows = await keitaroGuiService.getTodayLeadsByMetaCampaignId();
                const leadsByMetaCampaignId = new Map(rows.map((row) => [
                    String(row.metaCampaignId),
                    Number(row.leads) || 0,
                ]));
                const updated = {
                    ...data,
                    campaigns: data.campaigns.map((campaign) => {
                        const leads = leadsByMetaCampaignId.get(String(campaign.id)) ?? 0;
                        return {
                            ...campaign,
                            leads,
                            costPerLead: leads > 0
                                ? Number(campaign.spend) / leads
                                : null,
                            leadSource: "keitaro",
                            leadSyncStatus: "ready",
                        };
                    }),
                };
                await remoteDataCacheStore.setCampaigns(
                    accountKey,
                    adAccountId,
                    datePreset,
                    updated
                );
                sendRendererEvent("campaigns:keitaro-leads-refreshed", {
                    accountKey,
                    adAccountId,
                    datePreset,
                    data: updated,
                });
                return updated;
            } catch (error) {
                sendRendererEvent("campaigns:keitaro-leads-refreshed", {
                    accountKey,
                    adAccountId,
                    datePreset,
                    error: serializeError(error),
                });
                return null;
            } finally {
                keitaroLeadRefreshes.delete(key);
            }
        })();
        keitaroLeadRefreshes.set(key, refresh);
        return refresh;
    };

    const applyInsightMetrics = (campaigns, statisticsCampaigns) => {
        const statsById = new Map(statisticsCampaigns.map((campaign) => [
            String(campaign.id),
            campaign,
        ]));
        return campaigns.map((campaign) => {
            const stats = statsById.get(String(campaign.id));
            if (!stats) return campaign;
            const keepKeitaro = campaign.leadSource === "keitaro";
            return {
                ...campaign,
                spend: stats.spend,
                impressions: stats.impressions,
                clicks: stats.clicks,
                cpm: stats.cpm,
                ctr: stats.ctr,
                metaLeads: stats.leads,
                ...(keepKeitaro
                    ? {
                        costPerLead: Number(campaign.leads) > 0
                            ? Number(stats.spend) / Number(campaign.leads)
                            : null,
                    }
                    : {
                        leads: stats.leads,
                        costPerLead: stats.costPerLead,
                        leadSource: "meta",
                        leadSyncStatus: "ready",
                    }),
            };
        });
    };

    const readCachedCampaigns = async ({
        accountKey,
        adAccountId,
        datePreset,
    }) => {
        const cached = await remoteDataCacheStore.getCampaigns(
            accountKey,
            adAccountId,
            datePreset
        );
        if (!cached) {
            return {
                adAccountId,
                datePreset,
                campaigns: [],
                statisticsUpdatedAt: null,
                cacheHit: false,
            };
        }
        return {
            ...cached.value,
            campaigns: await adAccountPreferencesStore.enrichCampaigns(
                adAccountId,
                cached.value.campaigns ?? []
            ),
            cacheHit: true,
        };
    };

    const loadRemoteCampaignStatistics = async ({
        accountKey,
        adAccountId,
        datePreset,
    }) => {
        const cached = await remoteDataCacheStore.getCampaigns(
            accountKey,
            adAccountId,
            datePreset
        );
        if (!cached?.value?.campaigns?.length) {
            throw Object.assign(
                new Error("Спочатку оновіть список кампаній"),
                { code: "CAMPAIGN_LIST_REQUIRED" }
            );
        }
        if (!shouldRefreshCampaignStatistics(cached.value.statisticsUpdatedAt)) {
            return {
                ...cached.value,
                campaigns: await adAccountPreferencesStore.enrichCampaigns(
                    adAccountId,
                    cached.value.campaigns
                ),
                cacheHit: true,
                statisticsSkipped: true,
            };
        }
        const statistics = await guiService.getAdCampaignStatistics(
            accountKey,
            adAccountId,
            datePreset,
            cached.value.campaigns
        );
        const updated = {
            ...cached.value,
            campaigns: await adAccountPreferencesStore.enrichCampaigns(
                adAccountId,
                applyInsightMetrics(cached.value.campaigns, statistics.campaigns)
            ),
            statisticsUpdatedAt: new Date().toISOString(),
            cacheHit: true,
            statisticsSkipped: false,
        };
        await remoteDataCacheStore.setCampaigns(
            accountKey,
            adAccountId,
            datePreset,
            updated
        );
        sendRendererEvent("campaigns:refreshed", {
            accountKey,
            adAccountId,
            datePreset,
            data: updated,
        });
        return updated;
    };

    const refreshCampaignData = async ({
        accountKey,
        adAccountId,
        datePreset,
    }) => {
        const data = await loadRemoteCampaigns({
            accountKey,
            adAccountId,
            datePreset,
            refreshKeitaro: false,
        });
        const statistics = data.campaigns.length > 0
            ? await loadRemoteCampaignStatistics({
                accountKey,
                adAccountId,
                datePreset,
            })
            : data;
        const keitaroLeadSyncEnabled = await adAccountPreferencesStore
            .isKeitaroLeadSyncEnabled(adAccountId);
        if (keitaroLeadSyncEnabled && datePreset === "today") {
            refreshKeitaroCampaignLeadsOnce({
                accountKey,
                adAccountId,
                datePreset,
                data: statistics ?? data,
            });
        }
        return statistics ?? data;
    };
    const mergeAccountStates = async (graphAccounts) => {
        const storedAccounts = await facebookAccountManager.list();
        const graphByKey = new Map(graphAccounts.map((account) => [
            account.accountKey,
            account,
        ]));
        return storedAccounts.map((stored) => {
            if (stored.archived) {
                return {
                    ...stored,
                    status: "archived",
                    error: null,
                };
            }
            const graphAccount = graphByKey.get(stored.accountKey) ?? {
                status: "error",
                error: { message: "Акаунт не завантажено" },
            };
            return {
                ...stored,
                adsPowerOpen: null,
                ...graphAccount,
                name: stored.name ?? "",
                archived: false,
            };
        });
    };

    const refreshAdsPowerStates = (accounts) => {
        if (adsPowerStateRefresh) return adsPowerStateRefresh;
        sendRendererEvent("accounts:adspower-states", { type: "started" });
        adsPowerStateRefresh = (async () => {
            const accountsWithAdsPower = accounts.filter((account) => (
                account.adsPowerProfileNo && !account.archived
            ));
            let states = new Map();
            try {
                states = await guiService.getAdsPowerProfileOpenStates(
                    accountsWithAdsPower.map((account) => account.adsPowerProfileNo)
                );
            } catch (error) {
                if (typeof logger?.warn === "function") {
                    logger.warn(
                        "accounts.adspower-state-failed",
                        "Не вдалося пакетно перевірити AdsPower-профілі",
                        { error }
                    );
                }
            }
            for (const account of accountsWithAdsPower) {
                sendRendererEvent("accounts:adspower-states", {
                    type: "updated",
                    accountKey: account.accountKey,
                    adsPowerOpen: states.get(account.adsPowerProfileNo) ?? null,
                });
            }
        })().finally(() => {
            adsPowerStateRefresh = null;
            sendRendererEvent("accounts:adspower-states", { type: "completed" });
        });
        return adsPowerStateRefresh;
    };
    const prepareManagedAccounts = async (graphAccounts) => {
        const accounts = await mergeAccountStates(graphAccounts);
        refreshAdsPowerStates(accounts);
        return accounts;
    };
    const refreshManagedAccounts = async () => prepareManagedAccounts(
        await guiService.refreshAccounts()
    );
    const refreshClientsAfterProxyChange = async () => {
        try {
            await refreshManagedAccounts();
        } catch (error) {
            logger?.warn(
                "proxies.clients-refresh-failed",
                "Не вдалося перечитати Facebook-клієнти після зміни проксі",
                { error }
            );
        }
    };
    const listProxies = async () => proxyManager.list();
    const sendCampaignProgress = (payload) => {
        const window = getWindow();
        if (window && !window.isDestroyed?.()) {
            window.webContents.send("campaign-creation:progress", payload);
        }
    };

    const progressValue = (progress, adSetCount) => {
        const count = Number(adSetCount) || 0;
        if (progress.stage === "preflight-complete") return 1;
        if (progress.stage === "campaign") return 2;
        if (progress.stage === "creative") return 3;
        if (progress.stage === "adset") return 4 + Number(progress.index || 0);
        if (progress.stage === "ad") return 3 + count + Number(progress.index || 0) + 1;
        if (progress.stage === "complete") return 3 + count * 2;
        return undefined;
    };

    const runCreationJob = async (job, { signal, taskProgress } = {}) => {
        const assertNotAborted = () => {
            if (!signal?.aborted) return;
            throw Object.assign(new Error("Створення кампанії перервано"), {
                name: "AbortError",
                code: "CAMPAIGN_CREATION_INTERRUPTED",
            });
        };
        job = await campaignCreationJournal.update(job.id, {
            status: "running",
            errors: [],
        });
        const template = await templateManager.get(job.input.templateId);
        const onProgress = async (progress) => {
            assertNotAborted();
            const completed = progressValue(progress, job.input.adSetCount);
            const updated = await campaignCreationJournal.update(job.id, {
                stage: progress.stage,
                ...(completed === undefined ? {} : { completed }),
                ...(progress.objects ? { objects: progress.objects } : {}),
            });
            sendCampaignProgress({
                jobId: job.id,
                ...progress,
                completed: updated.completed,
                total: updated.total,
            });
            if (typeof taskProgress === "function") {
                await taskProgress({
                    stage: progress.stage,
                    completed: updated.completed,
                    total: updated.total,
                    message: progress.message,
                    objects: progress.objects,
                });
            }
            assertNotAborted();
        };

        try {
            const result = await guiService.createLeadCampaign({
                ...job.input,
                template,
                resume: job.objects,
            }, onProgress);
            await updateCacheSafely(
                () => remoteDataCacheStore.invalidateCampaigns(
                    job.input.accountKey,
                    job.input.adAccountId
                ),
                {
                    channel: "campaigns:invalidated",
                    payload: {
                        accountKey: job.input.accountKey,
                        adAccountId: job.input.adAccountId,
                    },
                }
            );
            const updated = await campaignCreationJournal.update(job.id, {
                status: "complete",
                stage: "complete",
                completed: job.total,
                objects: result.objects,
                errors: [],
            });
            return { job: updated, result };
        } catch (error) {
            const safeError = serializeError(error);
            await campaignCreationJournal.update(job.id, {
                status: signal?.aborted ? "interrupted" : "failed",
                stage: error.stage ?? "unknown",
                objects: error.createdObjects ?? job.objects,
                errors: [safeError],
            });
            sendCampaignProgress({
                jobId: job.id,
                stage: signal?.aborted ? "interrupted" : "failed",
                error: safeError,
            });
            error.jobId = job.id;
            error.reportDetails = {
                inputSummary: {
                    campaignJobId: job.id,
                    accountKey: job.input.accountKey,
                    adAccountId: job.input.adAccountId,
                    campaignName: job.input.campaignName,
                    templateId: job.input.templateId,
                    pageId: job.input.pageId,
                    postId: job.input.postId,
                    adSetCount: job.input.adSetCount,
                    dailyBudget: job.input.dailyBudget,
                    startTime: job.input.startTime,
                    createPaused: job.input.createPaused,
                    createAdSetsPaused: job.input.createAdSetsPaused,
                    createAdsPaused: job.input.createAdsPaused,
                    creativeMode: job.input.creativeMode,
                },
                resultSummary: { objects: error.createdObjects ?? job.objects },
                errors: [safeError],
            };
            throw error;
        }
    };

    const enqueueCampaignJob = async (job, name = job.input.campaignName) => {
        const task = await backgroundTaskManager.enqueue({
            type: "campaign",
            name,
            uniqueKey: `campaign-job:${job.id}`,
            resources: [{
                key: "facebook-campaign-write",
                label: "черга створення рекламних кампаній",
            }],
            input: { campaignJobId: job.id },
            metadata: {
                campaignJobId: job.id,
                accountKey: job.input.accountKey,
                adAccountId: job.input.adAccountId,
            },
            runner: async ({ signal, progress }) => {
                const response = await runCreationJob(job, {
                    signal,
                    taskProgress: progress,
                });
                return {
                    result: {
                        campaignJobId: job.id,
                        campaignId: response.result?.objects?.campaignId ?? null,
                        warnings: response.result?.readback?.warnings ?? [],
                    },
                    taskStatus: response.result?.readback?.warnings?.length
                        ? "completed_with_warnings"
                        : "completed",
                    reportDetails: {
                        inputSummary: {
                            campaignJobId: job.id,
                            accountKey: job.input.accountKey,
                            adAccountId: job.input.adAccountId,
                            campaignName: job.input.campaignName,
                            templateId: job.input.templateId,
                            pageId: job.input.pageId,
                            postId: job.input.postId,
                            adSetCount: job.input.adSetCount,
                            dailyBudget: job.input.dailyBudget,
                            startTime: job.input.startTime,
                            createPaused: job.input.createPaused,
                            createAdSetsPaused: job.input.createAdSetsPaused,
                            createAdsPaused: job.input.createAdsPaused,
                            creativeMode: job.input.creativeMode,
                        },
                        resultSummary: {
                            campaignJobId: job.id,
                            objects: response.result?.objects,
                            readback: response.result?.readback,
                        },
                        warnings: response.result?.readback?.warnings ?? [],
                    },
                };
            },
        });
        return { taskId: task.id, task, jobId: job.id };
    };

    const enqueueCreativeLaunch = async (launchJob) => {
        const task = await backgroundTaskManager.enqueue({
            type: "creative-launch",
            name: launchJob.draft.campaignName || `Запуск · ${launchJob.draft.geo} · Creo_${launchJob.draft.creativeName}`,
            uniqueKey: `creative-launch:${launchJob.id}`,
            resources: [{ key: "global-workflow", label: "глобальна черга" }],
            input: { workflowJobId: launchJob.id },
            metadata: { workflowJobId: launchJob.id, accountKey: launchJob.draft.accountKey, pageId: launchJob.draft.pageId },
            runner: async ({ signal, progress, waitForAction }) => {
                let job = await creativeLaunchJournal.update(launchJob.id, { status: "running", errors: [] });
                const draft = job.draft;
                const creativeGeo = draft.language || draft.geo;
                const setSubtask = async (id, patch) => {
                    job = await creativeLaunchJournal.updateSubtask(job.id, id, patch);
                    const subtasks = job.subtasks;
                    await progress({
                        stage: id,
                        message: patch.message || subtasks.find((item) => item.id === id)?.message,
                        completed: subtasks.filter((item) => ["completed", "completed_with_warnings", "failed", "skipped"].includes(item.status)).length,
                        total: 3,
                        subtasks,
                    });
                };
                const abort = () => {
                    if (signal.aborted) throw Object.assign(new Error("Запуск креативу перервано"), { name: "AbortError", code: "CREATIVE_LAUNCH_ABORTED" });
                };
                try {
                    await setSubtask("publication", { status: "running", message: "Перевіряємо дані й готуємо креатив" });
                    abort();
                    const [template, pages, accounts, groups, prepared] = await Promise.all([
                        templateManager.get(draft.templateId),
                        guiService.getFanPages(draft.accountKey),
                        guiService.getAdAccounts(draft.accountKey),
                        guiService.getAdsPowerGroups(),
                        guiService.prepareCreative({ geo: creativeGeo, creativeName: draft.creativeName, siteUrl: draft.siteUrl }),
                    ]);
                    if (!pages.some((page) => String(page.id) === draft.pageId)) throw Object.assign(new Error("Фанпейджа недоступна API-клієнту"), { code: "CREATIVE_LAUNCH_PAGE_UNAVAILABLE" });
                    const adAccount = accounts.find((account) => String(account.id) === draft.adAccountId);
                    if (!adAccount || Number(adAccount.accountStatus) !== 1) throw Object.assign(new Error("Рекламний акаунт недоступний або неактивний"), { code: "CREATIVE_LAUNCH_AD_ACCOUNT_UNAVAILABLE" });
                    if (!Array.isArray(template.countryCodes) || !template.countryCodes.length) throw Object.assign(new Error("У шаблоні не вибрано країну"), { code: "CAMPAIGN_COUNTRY_REQUIRED" });
                    if (!Number.isInteger(draft.adSetCount) || draft.adSetCount < 1 || draft.adSetCount > 100) throw Object.assign(new Error("Кількість ad sets має бути від 1 до 100"), { code: "CAMPAIGN_ADSET_COUNT_INVALID" });
                    if (!Number.isFinite(draft.dailyBudget) || draft.dailyBudget <= 0) throw Object.assign(new Error("Бюджет ad set має бути більшим за нуль"), { code: "CAMPAIGN_BUDGET_INVALID" });
                    if (Number.isNaN(new Date(draft.startTime).getTime())) throw Object.assign(new Error("Некоректний час початку"), { code: "CAMPAIGN_START_TIME_INVALID" });
                    const pixels = await guiService.getAdPixels({ accountKey: draft.accountKey, adAccountId: draft.adAccountId });
                    if (!pixels.some((pixel) => pixel.id === draft.pixelId)) throw Object.assign(new Error("Pixel недоступний вибраному РК"), { code: "CAMPAIGN_PIXEL_ACCESS_DENIED" });
                    const knownGroups = new Set(groups.map((group) => String(group.groupId)));
                    if (!draft.groupIds.length || draft.groupIds.some((id) => !knownGroups.has(id))) throw Object.assign(new Error("Вибрані AdsPower-групи недоступні"), { code: "COMMENTING_GROUP_REQUIRED" });
                    abort();

                    let cleanup = { deleted: [], failed: [] };
                    if (draft.deleteOldPosts) {
                        await setSubtask("publication", { status: "running", message: "Видаляємо старі URL-пости" });
                        const oldPosts = await guiService.getPagePostsWithLinks({ accountKey: draft.accountKey, pageId: draft.pageId, limit: 10 });
                        cleanup = await guiService.deletePagePosts({ accountKey: draft.accountKey, pageId: draft.pageId, posts: oldPosts });
                        job = await creativeLaunchJournal.update(job.id, { cleanup });
                    }
                    abort();
                    const post = await guiService.publishPreparedPost({
                        accountKey: draft.accountKey, pageId: draft.pageId,
                        message: prepared.creative, imagePath: draft.imagePath, imagePaths: draft.imagePaths,
                    }, async (item) => setSubtask("publication", { status: "running", message: item.message, progress: item }));
                    await updateCacheSafely(async () => {
                        await remoteDataCacheStore.removePosts(
                            draft.accountKey,
                            draft.pageId,
                            cleanup.deleted
                        );
                        await remoteDataCacheStore.prependPost(
                            draft.accountKey,
                            draft.pageId,
                            {
                                id: post.postId,
                                postId: post.postId,
                                message: post.message,
                                permalinkUrl: post.permalinkUrl,
                                createdTime: post.createdTime,
                                thumbnailUrl: null,
                            }
                        );
                    }, {
                        channel: "pages:posts-cache-updated",
                        payload: {
                            type: "replace-after-publication",
                            accountKey: draft.accountKey,
                            pageId: draft.pageId,
                            removedPostIds: cleanup.deleted.map((item) => item.id),
                            post: {
                                id: post.postId,
                                postId: post.postId,
                                message: post.message,
                                permalinkUrl: post.permalinkUrl,
                                createdTime: post.createdTime,
                                thumbnailUrl: null,
                            },
                        },
                    });
                    await pagePreferencesStore.updateMetadata(draft.pageId, {
                        geo: draft.geo,
                        language: draft.language,
                        creativeName: draft.creativeName,
                    });
                    job = await creativeLaunchJournal.update(job.id, { post, cleanup });
                    await setSubtask("publication", {
                        status: cleanup.failed.length ? "completed_with_warnings" : "completed",
                        message: cleanup.failed.length ? `Пост опубліковано; не видалено ${cleanup.failed.length}` : "Пост опубліковано та перевірено",
                        result: post,
                    });

                    const campaignBranch = async () => {
                        await setSubtask("campaign", { status: "running", message: "Перевіряємо й створюємо кампанію" });
                        const campaignJob = await campaignCreationJournal.create({
                            ...draft, pageId: draft.pageId, postId: post.postId,
                        });
                        await creativeLaunchJournal.update(job.id, { campaignJobId: campaignJob.id });
                        try {
                            const response = await runCreationJob(campaignJob, {
                                signal,
                                taskProgress: (item) => setSubtask("campaign", { status: "running", message: item.message, progress: item }),
                            });
                            await setSubtask("campaign", { status: "completed", message: "Кампанію створено", result: response.result });
                            return response.result;
                        } catch (error) {
                            await setSubtask("campaign", { status: "failed", message: error.message, error: serializeError(error) });
                            throw error;
                        }
                    };
                    const commentsBranch = async () => {
                        await setSubtask("comments", { status: "running", message: "Запускаємо паралельні коментарі" });
                        try {
                            const workerProxies = await resolveWorkerProxies(
                                proxyManager,
                                draft.commentWorkerProxyIds
                            );
                            const response = await guiService.runParallelComments({
                                groupIds: draft.groupIds, comments: prepared.comments,
                                geo: creativeGeo, creativeName: draft.creativeName,
                                postUrl: post.permalinkUrl, browserMode: draft.browserMode,
                                disableImages: draft.disableImages, concurrency: draft.commentWorkerConcurrency,
                                workerProxies,
                                onProxyUnavailable: createProxyUnavailableHandler({
                                    proxyManager,
                                    progress,
                                    waitForAction,
                                }),
                                signal,
                                onProgress: async (item) => {
                                    await setSubtask("comments", { status: "running", message: item.message, progress: item });
                                    if (item.workerProxyAlerts) {
                                        await progress({
                                            message: item.message,
                                            workerProxyAlerts: item.workerProxyAlerts,
                                        });
                                    }
                                },
                            });
                            const report = response.report;
                            const warned = report.failedComments.length || report.skipped.length || report.cleanupWarnings.length;
                            await creativeLaunchJournal.update(job.id, { commentsResume: {
                                publishedCommentIds: report.published.map((item) => item.commentId),
                                profileKeyMap: report.profileKeyMap,
                                uncertainCommentIds: report.interrupted ? report.failedComments.map((item) => item.commentId) : [],
                            } });
                            await setSubtask("comments", { status: warned ? "completed_with_warnings" : "completed", message: `Коментарі: ${report.published.length} успішно`, result: { published: report.published.length, failed: report.failedComments.length, skipped: report.skipped.length } });
                            return report;
                        } catch (error) {
                            await setSubtask("comments", { status: signal.aborted ? "interrupted" : "failed", message: error.message, error: serializeError(error) });
                            throw error;
                        }
                    };
                    const branches = await Promise.allSettled([campaignBranch(), commentsBranch()]);
                    abort();
                    const warnings = cleanup.failed.length + branches.filter((item) => item.status === "rejected").length;
                    job = await creativeLaunchJournal.update(job.id, { status: warnings ? "completed_with_warnings" : "completed" });
                    return {
                        taskStatus: warnings ? "completed_with_warnings" : "completed",
                        result: { workflowJobId: job.id, post, warnings },
                        reportDetails: { inputSummary: { workflowJobId: job.id, accountKey: draft.accountKey, pageId: draft.pageId, geo: draft.geo, creativeName: draft.creativeName, adAccountId: draft.adAccountId }, resultSummary: { post, cleanup, subtasks: job.subtasks }, warnings: cleanup.failed },
                    };
                } catch (error) {
                    await creativeLaunchJournal.update(job.id, { status: signal.aborted ? "interrupted" : "failed", errors: [serializeError(error)] });
                    error.reportDetails ??= { inputSummary: { workflowJobId: job.id, accountKey: draft.accountKey, pageId: draft.pageId }, resultSummary: { post: job.post, subtasks: job.subtasks }, errors: [serializeError(error)] };
                    throw error;
                }
            },
        });
        return { taskId: task.id, task, workflowJobId: launchJob.id };
    };

    ipcMain.handle(
        "accounts:list",
        safeHandler(async () => prepareManagedAccounts(
            await guiService.getAccounts()
        ))
    );
    ipcMain.handle(
        "accounts:refresh",
        safeHandler(refreshManagedAccounts)
    );
    ipcMain.handle(
        "accounts:create",
        safeHandler(async (payload) => {
            await facebookAccountManager.create(payload);
            return refreshManagedAccounts();
        })
    );
    ipcMain.handle(
        "accounts:update",
        safeHandler(async ({ accountKey, ...patch }) => {
            const account = await facebookAccountManager.update(accountKey, patch);
            await guiService.reloadFacebookBackend();
            return account;
        })
    );
    ipcMain.handle(
        "accounts:check",
        safeHandler(async ({ accountKey }) => {
            const account = await facebookAccountManager.get(accountKey);
            const [status, adsPowerOpen] = await Promise.all([
                guiService.checkAccount(accountKey),
                account.adsPowerProfileNo
                    ? guiService.getAdsPowerProfileOpenState(
                        account.adsPowerProfileNo
                    )
                    : Promise.resolve(null),
            ]);
            return {
                ...account,
                ...status,
                name: account.name,
                adsPowerOpen,
            };
        })
    );
    ipcMain.handle(
        "accounts:sync-from-adspower",
        safeHandler(async ({ accountKey, browserMode, disableImages }) => {
            const normalizedKey = String(accountKey ?? "").trim();
            const account = (await facebookAccountManager.list()).find((item) => (
                item.accountKey.toLowerCase() === normalizedKey.toLowerCase()
            ));
            if (!account) throw Object.assign(new Error("API-клієнт не знайдено"), { code: "FACEBOOK_ACCOUNT_NOT_FOUND" });
            if (!account.adsPowerProfileNo) throw Object.assign(new Error("Для API-клієнта не вказано номер AdsPower"), { code: "ADSPOWER_PROFILE_NO_REQUIRED" });
            const task = await backgroundTaskManager.enqueue({
                type: "facebook-api-client-sync",
                name: `Синхронізація API-клієнта ${account.accountKey}`,
                uniqueKey: `facebook-api-client-sync:${account.accountKey}`,
                resources: [{ key: `adspower-profile:${account.adsPowerProfileNo}`, label: `AdsPower №${account.adsPowerProfileNo}` }],
                input: { accountKey: account.accountKey, adsPowerProfileNo: account.adsPowerProfileNo },
                metadata: { accountKey: account.accountKey },
                runner: async ({ signal, progress }) => {
                    const credentials = await guiService.syncFacebookApiClientFromAdsPowerProfile({
                        profileNo: account.adsPowerProfileNo,
                        browserMode: browserMode === "headless" ? "headless" : "visible",
                        disableImages: disableImages === true,
                        signal,
                        onProgress: progress,
                    });
                    await facebookAccountManager.update(account.accountKey, {
                        userAgent: credentials.userAgent,
                        accessToken: credentials.accessToken,
                        cookie: credentials.cookies,
                    });
                    await guiService.reloadFacebookBackend();
                    void guiService.checkAccount(account.accountKey)
                        .then((accountStatus) => {
                            sendRendererEvent("accounts:facebook-status", {
                                accountKey: account.accountKey,
                                accountStatus,
                            });
                        })
                        .catch((error) => {
                            logger?.warn?.(
                                "accounts.facebook-status-failed",
                                `Не вдалося перевірити Facebook API-клієнт ${account.accountKey}`,
                                { error }
                            );
                        });
                    return {
                        result: { accountKey: account.accountKey, adsPowerProfileNo: account.adsPowerProfileNo, userAgentUpdated: true, accessTokenUpdated: true, cookieUpdated: true },
                        reportDetails: { inputSummary: { accountKey: account.accountKey, adsPowerProfileNo: account.adsPowerProfileNo }, resultSummary: { credentialsUpdated: true } },
                    };
                },
            });
            return { taskId: task.id, task };
        })
    );
    ipcMain.handle(
        "accounts:adspower-open",
        safeHandler(async ({ accountKey }) => {
            const account = (await facebookAccountManager.list()).find((item) => (
                item.accountKey === String(accountKey ?? "").trim()
            ));
            if (!account?.adsPowerProfileNo) throw Object.assign(new Error("Додайте номер профілю AdsPower"), { code: "ADSPOWER_PROFILE_NO_REQUIRED" });
            await guiService.openAdsPowerProfile(account.adsPowerProfileNo);
            return { accountKey: account.accountKey, adsPowerOpen: true };
        })
    );
    ipcMain.handle(
        "accounts:adspower-close",
        safeHandler(async ({ accountKey }) => {
            const account = (await facebookAccountManager.list()).find((item) => (
                item.accountKey === String(accountKey ?? "").trim()
            ));
            if (!account?.adsPowerProfileNo) throw Object.assign(new Error("Додайте номер профілю AdsPower"), { code: "ADSPOWER_PROFILE_NO_REQUIRED" });
            const adsPowerOpen = await guiService.getAdsPowerProfileOpenState(
                account.adsPowerProfileNo
            );
            if (adsPowerOpen) {
                await guiService.closeAdsPowerProfile(account.adsPowerProfileNo);
            }
            return { accountKey: account.accountKey, adsPowerOpen: false };
        })
    );
    ipcMain.handle(
        "accounts:archive-set",
        safeHandler(async ({ accountKey, archived }) => {
            await facebookAccountManager.setArchived(accountKey, archived);
            return refreshManagedAccounts();
        })
    );
    ipcMain.handle(
        "accounts:delete",
        safeHandler(async ({ accountKey }) => {
            await facebookAccountManager.delete(accountKey);
            return refreshManagedAccounts();
        })
    );
    ipcMain.handle("proxies:list", safeHandler(listProxies));
    ipcMain.handle(
        "proxies:get",
        safeHandler(async ({ proxyId }) => proxyManager.getById(proxyId))
    );
    ipcMain.handle(
        "proxies:create",
        safeHandler(async (payload) => {
            await proxyManager.create(payload);
            await refreshClientsAfterProxyChange();
            return listProxies();
        })
    );
    ipcMain.handle(
        "proxies:update",
        safeHandler(async ({ proxyId, ...patch }) => {
            await proxyManager.update(proxyId, patch);
            await refreshClientsAfterProxyChange();
            return listProxies();
        })
    );
    ipcMain.handle(
        "proxies:delete",
        safeHandler(async ({ proxyId }) => {
            await proxyManager.remove(proxyId);
            await refreshClientsAfterProxyChange();
            return listProxies();
        })
    );
    ipcMain.handle(
        "proxies:reorder",
        safeHandler(async ({ orderedIds }) => {
            await proxyManager.reorder(orderedIds);
            await refreshClientsAfterProxyChange();
            return listProxies();
        })
    );
    ipcMain.handle(
        "proxies:check",
        safeHandler(async ({ proxyId }) => {
            const proxy = await proxyManager.getById(proxyId);
            const result = await checkProxyFn(proxy);
            return {
                proxyId: proxy.id,
                working: Boolean(result?.working),
                ip: result?.working ? result.ip ?? null : null,
                error: result?.working ? null : result?.error ?? null,
            };
        })
    );
    ipcMain.handle(
        "proxies:check-config",
        safeHandler(async ({
            proxyId,
            type,
            host,
            port,
            username,
            password,
        }) => {
            const stored = proxyId
                ? await proxyManager.getById(proxyId)
                : null;
            const proxy = {
                type: String(type ?? stored?.type ?? "").trim().toLowerCase(),
                host: String(host ?? "").trim() || stored?.host || "",
                port: String(port ?? "").trim() || stored?.port || "",
                username: String(username ?? "").length
                    ? username
                    : stored?.username || "",
                password: String(password ?? "").length
                    ? password
                    : stored?.password || "",
            };
            if (proxy.type === "no_proxy") {
                const error = new Error("Для режиму без проксі перевірка не потрібна");
                error.code = "PROXY_CHECK_NOT_NEEDED";
                throw error;
            }
            const result = await checkProxyFn(proxy);
            return {
                working: Boolean(result?.working),
                ip: result?.working ? result.ip ?? null : null,
                error: result?.working ? null : result?.error ?? null,
            };
        })
    );
    ipcMain.handle(
        "proxies:refresh-ip",
        safeHandler(async ({ proxyId }) => {
            const proxy = await proxyManager.getById(proxyId);
            const result = await refreshProxyIpFn(proxy);
            return {
                proxyId: proxy.id,
                working: Boolean(result?.working),
                timedOut: Boolean(result?.timedOut),
                ip: result?.working ? result.ip ?? null : null,
            };
        })
    );
    ipcMain.handle(
        "pages:list",
        safeHandler(async ({ accountKey, force = false }) => {
            const cached = await remoteDataCacheStore.getWorkspace(accountKey);
            if (!force) {
                if (cached) {
                    refreshWorkspaceOnce(accountKey);
                    return pagePreferencesStore.enrich(cached.value.pages ?? []);
                }
            }
            const previousPictures = new Map(
                (cached?.value?.pages ?? []).map((page) => [
                    String(page.id),
                    page.pictureUrl ?? null,
                ])
            );
            const list = await guiService.getFanPageList(
                accountKey,
                { force: true }
            );
            const pages = await pagePreferencesStore.enrich(list.map((page) => ({
                ...page,
                pictureUrl: previousPictures.get(String(page.id))
                    ?? page.pictureUrl
                    ?? null,
            })));
            await remoteDataCacheStore.setWorkspacePart(accountKey, { pages });
            const updated = await remoteDataCacheStore.getWorkspace(accountKey);
            return pagePreferencesStore.enrich(updated?.value?.pages ?? pages);
        })
    );
    ipcMain.handle(
        "workspace:client-load",
        safeHandler(async ({ accountKey, force = false }) => {
            if (force) return loadRemoteWorkspace(accountKey);
            const cached = await remoteDataCacheStore.getWorkspace(accountKey);
            if (!cached) return loadRemoteWorkspace(accountKey);
            return enrichCachedWorkspace(accountKey, cached.value);
        })
    );
    ipcMain.handle("pages:favorite-set", safeHandler(({ pageId, isFavorite }) => pagePreferencesStore.setFavorite(pageId, Boolean(isFavorite))));
    ipcMain.handle("pages:metadata-update", safeHandler(({ pageId, ...patch }) => pagePreferencesStore.updateMetadata(pageId, patch)));
    ipcMain.handle("pages:posts-with-links", safeHandler(async (payload) => {
        if (!payload.force) {
            const cached = await remoteDataCacheStore.getPosts(
                payload.accountKey,
                payload.pageId
            );
            if (cached) return cached.value;
        }
        const posts = await guiService.getPagePostsWithLinks(payload);
        await remoteDataCacheStore.setPosts(
            payload.accountKey,
            payload.pageId,
            posts
        );
        const cached = await remoteDataCacheStore.getPosts(
            payload.accountKey,
            payload.pageId
        );
        return cached?.value ?? posts;
    }));
    ipcMain.handle(
        "pages:posts-signature",
        safeHandler((payload) => guiService.getPagePostsSignature(payload))
    );
    ipcMain.handle("pages:selected-refresh", safeHandler(async (payload) => {
        const [details, posts] = await Promise.all([
            guiService.getFanPageDetails(payload),
            guiService.getPagePostsWithLinks({ ...payload, limit: 10 }),
        ]);
        const [page] = await pagePreferencesStore.enrich([details]);
        const cached = await remoteDataCacheStore.getWorkspace(payload.accountKey);
        const currentPages = cached?.value?.pages ?? [];
        const pages = currentPages.some(
            (item) => String(item.id) === String(page.id)
        ) ? currentPages.map((item) => (
                String(item.id) === String(page.id) ? { ...item, ...page } : item
            )) : [...currentPages, page];
        await Promise.all([
            remoteDataCacheStore.setWorkspacePart(payload.accountKey, { pages }),
            remoteDataCacheStore.setPosts(
                payload.accountKey,
                payload.pageId,
                posts
            ),
        ]);
        const [updatedWorkspace, updatedPosts] = await Promise.all([
            remoteDataCacheStore.getWorkspace(payload.accountKey),
            remoteDataCacheStore.getPosts(payload.accountKey, payload.pageId),
        ]);
        const updatedPage = updatedWorkspace?.value?.pages?.find(
            (item) => String(item.id) === String(payload.pageId)
        ) ?? page;
        const stablePosts = updatedPosts?.value ?? posts;
        return {
            page: updatedPage,
            posts: stablePosts,
            postCount: stablePosts.length,
        };
    }));
    ipcMain.handle(
        "pages:rebuild-requirements",
        safeHandler((payload) => guiService.getPageRebuildRequirements(payload))
    );
    ipcMain.handle("pages:rebuild-start", safeHandler(async (payload) => {
        const accountKey = String(payload.accountKey ?? "").trim();
        const pageId = String(payload.pageId ?? "").trim();
        const task = await backgroundTaskManager.enqueue({
            type: "page-rebuild",
            name: `Пересетаплення фанпейджа · ${pageId}`,
            uniqueKey: `page-rebuild:${accountKey}:${pageId}`,
            resources: [{
                key: `facebook-page:${accountKey}:${pageId}`,
                label: `фанпейджа ${pageId}`,
            }],
            input: {
                accountKey,
                pageId,
                imagesDirectory: payload.imagesDirectory,
                imagePaths: payload.imagePaths,
                pageCreatedAt: payload.pageCreatedAt ?? null,
                preserveDates: payload.preserveDates === true,
            },
            metadata: { accountKey, pageId },
            runner: async ({ signal, progress }) => {
                const result = await guiService.rebuildPageFromFolder({
                    accountKey,
                    pageId,
                    imagesDirectory: payload.imagesDirectory,
                    imagePaths: payload.imagePaths,
                    pageCreatedAt: payload.pageCreatedAt,
                    preserveDates: payload.preserveDates === true,
                }, progress, signal);
                await updateCacheSafely(
                    () => remoteDataCacheStore.clearPosts(accountKey, pageId),
                    {
                        channel: "pages:posts-cache-updated",
                        payload: { type: "clear", accountKey, pageId },
                    }
                );
                return {
                    result,
                    taskStatus: result.warnings.length
                        ? "completed_with_warnings"
                        : "completed",
                    reportDetails: {
                        inputSummary: { accountKey, pageId },
                        resultSummary: result,
                        warnings: result.warnings,
                    },
                };
            },
        });
        return { taskId: task.id, task };
    }));
    ipcMain.handle("ads:pixels-list", safeHandler((payload) => guiService.getAdPixels(payload)));
    ipcMain.handle("pages:posts-delete", safeHandler(async (payload) => {
        const task = await backgroundTaskManager.enqueue({
            type: "page-cleanup", name: `Видалення URL-постів · ${payload.pageId}`,
            input: { accountKey: payload.accountKey, pageId: payload.pageId }, metadata: { accountKey: payload.accountKey, pageId: payload.pageId },
            runner: async ({ signal, progress }) => {
                await progress({ stage: "load", completed: 0, total: 2, message: "Шукаємо URL-пости серед 10 найновіших" });
                const posts = await guiService.getPagePostsWithLinks({ ...payload, limit: 10 });
                if (signal.aborted) throw Object.assign(new Error("Видалення перервано"), { name: "AbortError" });
                const result = await guiService.deletePagePosts({ ...payload, posts });
                await updateCacheSafely(
                    () => remoteDataCacheStore.removePosts(
                        payload.accountKey,
                        payload.pageId,
                        result.deleted
                    ),
                    {
                        channel: "pages:posts-cache-updated",
                        payload: {
                            type: "remove",
                            accountKey: payload.accountKey,
                            pageId: payload.pageId,
                            postIds: result.deleted.map((item) => item.id),
                        },
                    }
                );
                await progress({ stage: "delete", completed: 2, total: 2, message: `Видалено ${result.deleted.length}, помилок ${result.failed.length}` });
                return { result, taskStatus: result.failed.length ? "completed_with_warnings" : "completed", reportDetails: { resultSummary: result, warnings: result.failed } };
            },
        });
        return { taskId: task.id, task };
    }));
    ipcMain.handle("pages:post-delete", safeHandler(async (payload) => {
        const task = await backgroundTaskManager.enqueue({
            type: "page-post-delete", name: `Видалення поста · ${payload.postId}`,
            input: { accountKey: payload.accountKey, pageId: payload.pageId, postId: payload.postId }, metadata: { accountKey: payload.accountKey, pageId: payload.pageId },
            runner: async ({ progress }) => {
                await progress({ stage: "delete", completed: 0, total: 1, message: "Видаляємо публікацію" });
                const result = await guiService.deletePagePosts({ ...payload, posts: [payload.postId] });
                if (result.failed.length) throw Object.assign(new Error(result.failed[0].error.message), { code: result.failed[0].error.code });
                await updateCacheSafely(
                    () => remoteDataCacheStore.removePosts(
                        payload.accountKey,
                        payload.pageId,
                        [payload.postId]
                    ),
                    {
                        channel: "pages:posts-cache-updated",
                        payload: {
                            type: "remove",
                            accountKey: payload.accountKey,
                            pageId: payload.pageId,
                            postIds: [payload.postId],
                        },
                    }
                );
                return { result };
            },
        });
        return { taskId: task.id, task };
    }));
    ipcMain.handle("creative-launch:start", safeHandler(async (payload) => enqueueCreativeLaunch(await creativeLaunchJournal.create(payload))));
    ipcMain.handle("creative-launch:get", safeHandler(async ({ workflowJobId }) => {
        const job = await creativeLaunchJournal.get(workflowJobId);
        if (!job) throw Object.assign(new Error("Workflow запуску не знайдено"), { code: "CREATIVE_LAUNCH_NOT_FOUND" });
        return job;
    }));
    ipcMain.handle("creative-launch:retry", safeHandler(async ({ workflowJobId, patch = {} }) => {
        const source = await creativeLaunchJournal.get(workflowJobId);
        if (!source) throw Object.assign(new Error("Workflow запуску не знайдено"), { code: "CREATIVE_LAUNCH_NOT_FOUND" });
        if (source.post?.postId) {
            throw Object.assign(new Error("Пост уже опублікований. Повний повтор заблоковано, щоб не створити дублікат; повторіть лише помилкову гілку з деталей задачі."), { code: "CREATIVE_LAUNCH_FULL_RETRY_UNSAFE" });
        }
        return enqueueCreativeLaunch(await creativeLaunchJournal.create({ ...source.draft, ...patch }, { parentJobId: source.id }));
    }));
    ipcMain.handle(
        "ads:list",
        safeHandler(async ({ accountKey }) => {
            const now = Date.now();
            const lastRefresh = adAccountRefreshTimes.get(accountKey) ?? 0;
            if (now - lastRefresh < manualRefreshIntervalMs) {
                if (adAccountRefreshResults.has(accountKey)) {
                    return adAccountRefreshResults.get(accountKey);
                }
                const cached = await remoteDataCacheStore.getWorkspace(accountKey);
                if (cached?.value?.adAccounts) {
                    return adAccountPreferencesStore.enrichAccounts(
                        accountKey,
                        cached.value.adAccounts
                    );
                }
            }
            const accounts = await guiService.getAdAccounts(accountKey);
            const enriched = await adAccountPreferencesStore.enrichAccounts(
                accountKey,
                accounts
            );
            await remoteDataCacheStore.setWorkspacePart(accountKey, {
                adAccounts: enriched,
            });
            adAccountRefreshTimes.set(accountKey, now);
            adAccountRefreshResults.set(accountKey, enriched);
            return enriched;
        })
    );
    ipcMain.handle(
        "ads:rename",
        safeHandler(({ adAccountId, name }) => (
            adAccountPreferencesStore.rename(adAccountId, name)
        ))
    );
    ipcMain.handle(
        "ads:favorite-set",
        safeHandler(({ accountKey, adAccountId, isFavorite }) => (
            adAccountPreferencesStore.setFavorite(
                accountKey,
                adAccountId,
                Boolean(isFavorite)
            )
        ))
    );
    ipcMain.handle(
        "ads:favorite-reorder",
        safeHandler(({ accountKey, orderedIds }) => (
            adAccountPreferencesStore.reorderFavorites(
                accountKey,
                orderedIds
            )
        ))
    );
    ipcMain.handle(
        "campaigns:list",
        safeHandler(async ({
            accountKey,
            adAccountId,
            datePreset = "today",
            force = false,
        }) => {
            const payload = { accountKey, adAccountId, datePreset };
            if (force) return loadRemoteCampaigns(payload);
            return readCachedCampaigns(payload);
        })
    );
    ipcMain.handle(
        "campaigns:statistics-refresh",
        safeHandler(async ({
            accountKey,
            adAccountId,
            datePreset = "today",
        }) => loadRemoteCampaignStatistics({
            accountKey,
            adAccountId,
            datePreset,
        }))
    );
    ipcMain.handle(
        "campaigns:refresh",
        safeHandler(async ({
            accountKey,
            adAccountId,
            datePreset = "today",
        }) => {
            const payload = { accountKey, adAccountId, datePreset };
            const key = [accountKey, adAccountId, datePreset].join("::");
            const now = Date.now();
            const lastRefresh = campaignRefreshTimes.get(key) ?? 0;
            if (now - lastRefresh < manualRefreshIntervalMs) {
                return readCachedCampaigns(payload);
            }
            campaignRefreshTimes.set(key, now);
            return refreshCampaignData(payload);
        })
    );
    ipcMain.handle(
        "ads:keitaro-lead-sync-set",
        safeHandler(async ({ accountKey, adAccountId, enabled }) => {
            const result = await adAccountPreferencesStore.setKeitaroLeadSync(
                adAccountId,
                enabled
            );
            if (!result.keitaroLeadSyncEnabled || !accountKey) return result;
            const data = await readCachedCampaigns({
                accountKey,
                adAccountId,
                datePreset: "today",
            });
            refreshKeitaroCampaignLeadsOnce({
                accountKey,
                adAccountId,
                datePreset: "today",
                data,
            });
            return result;
        })
    );
    ipcMain.handle(
        "campaigns:reorder",
        safeHandler(({ adAccountId, orderedIds }) => (
            adAccountPreferencesStore.reorderCampaigns(adAccountId, orderedIds)
        ))
    );
    ipcMain.handle(
        "campaigns:status-set",
        safeHandler(async ({ accountKey, adAccountId, campaignId, status }) => {
            const result = await guiService.setAdCampaignStatus(
                accountKey,
                campaignId,
                status
            );
            await remoteDataCacheStore.invalidateCampaigns(accountKey, adAccountId);
            return result;
        })
    );
    ipcMain.handle(
        "campaigns:rename",
        safeHandler(async ({ accountKey, adAccountId, campaignId, name }) => {
            const result = await guiService.renameAdCampaign(
                accountKey,
                campaignId,
                name
            );
            await remoteDataCacheStore.invalidateCampaigns(accountKey, adAccountId);
            return result;
        })
    );
    ipcMain.handle(
        "campaigns:delete",
        safeHandler(async ({ accountKey, adAccountId, campaignId }) => {
            const result = await guiService.deleteAdCampaign(accountKey, campaignId);
            await remoteDataCacheStore.invalidateCampaigns(accountKey, adAccountId);
            return result;
        })
    );
    ipcMain.handle(
        "campaigns:posts-list",
        safeHandler(async (payload) => {
            if (!payload.force) {
                const cached = await remoteDataCacheStore.getPosts(
                    payload.accountKey,
                    payload.pageId,
                    "campaign"
                );
                if (cached) return cached.value;
            }
            const posts = await guiService.getPagePosts(payload);
            await remoteDataCacheStore.setPosts(
                payload.accountKey,
                payload.pageId,
                posts,
                "campaign"
            );
            const cached = await remoteDataCacheStore.getPosts(
                payload.accountKey,
                payload.pageId,
                "campaign"
            );
            return cached?.value ?? posts;
        })
    );
    ipcMain.handle(
        "campaigns:create-preflight",
        safeHandler(async ({ templateId, accountKey, ...payload }) => {
            const template = await templateManager.get(templateId);
            return guiService.preflightLeadCampaign({
                accountKey,
                ...payload,
                template,
            });
        })
    );
    ipcMain.handle(
        "campaigns:create-start",
        safeHandler(async (payload) => {
            const job = await campaignCreationJournal.create(payload);
            return enqueueCampaignJob(job);
        })
    );
    ipcMain.handle(
        "campaigns:create-job",
        safeHandler(async ({ jobId }) => {
            const job = await campaignCreationJournal.get(jobId);
            if (!job) {
                const error = new Error("Спробу створення кампанії не знайдено");
                error.code = "CAMPAIGN_JOB_NOT_FOUND";
                throw error;
            }
            return job;
        })
    );
    ipcMain.handle(
        "campaigns:create-retry",
        safeHandler(async ({ jobId }) => {
            const job = await campaignCreationJournal.get(jobId);
            if (!job) {
                const error = new Error("Спробу створення кампанії не знайдено");
                error.code = "CAMPAIGN_JOB_NOT_FOUND";
                throw error;
            }
            const queued = await campaignCreationJournal.update(job.id, {
                status: "queued",
                errors: [],
            });
            return enqueueCampaignJob(
                queued,
                `${queued.input.campaignName} · повтор`
            );
        })
    );
    ipcMain.handle(
        "campaigns:create-cleanup",
        safeHandler(async ({ jobId }) => {
            const job = await campaignCreationJournal.get(jobId);
            if (!job) {
                const error = new Error("Спробу створення кампанії не знайдено");
                error.code = "CAMPAIGN_JOB_NOT_FOUND";
                throw error;
            }
            const task = await backgroundTaskManager.enqueue({
                type: "campaign-cleanup",
                name: `${job.input.campaignName} · очищення`,
                uniqueKey: `campaign-job:${job.id}`,
                resources: [{
                    key: "facebook-campaign-write",
                    label: "черга створення рекламних кампаній",
                }],
                input: { campaignJobId: job.id },
                metadata: { campaignJobId: job.id },
                runner: async ({ signal, progress: taskProgress }) => {
                    const cleanupTotal = (job.objects.ads?.length ?? 0)
                        + (job.objects.adSets?.length ?? 0)
                        + Number(Boolean(job.objects.creativeId))
                        + Number(Boolean(job.objects.campaignId));
                    let cleanupCompleted = 0;
                    const result = await guiService.deleteCampaignDraft({
                        accountKey: job.input.accountKey,
                        objects: job.objects,
                    }, async (item) => {
                        if (signal.aborted) throw Object.assign(
                            new Error("Очищення кампанії перервано"),
                            { name: "AbortError" }
                        );
                        sendCampaignProgress({
                            jobId: job.id,
                            stage: "cleanup",
                            ...item,
                        });
                        cleanupCompleted += 1;
                        await taskProgress({
                            stage: "cleanup",
                            completed: cleanupCompleted,
                            total: cleanupTotal,
                            message: `${item.type} ${item.id}`,
                        });
                    });
                    await campaignCreationJournal.update(job.id, {
                        status: result.failed.length ? "cleanup-partial" : "deleted",
                        stage: "cleanup",
                    });
                    return {
                        result,
                        taskStatus: result.failed.length
                            ? "completed_with_warnings"
                            : "completed",
                        reportDetails: {
                            inputSummary: {
                                campaignJobId: job.id,
                                accountKey: job.input.accountKey,
                                knownObjects: job.objects,
                            },
                            resultSummary: result,
                            warnings: result.failed,
                        },
                    };
                },
            });
            return { taskId: task.id, task, jobId: job.id };
        })
    );
    ipcMain.handle(
        "groups:list",
        safeHandler(() => guiService.getAdsPowerGroups())
    );
    ipcMain.handle(
        "groups:refresh",
        safeHandler(() => guiService.refreshAdsPowerGroups())
    );
    ipcMain.handle(
        "groups:profiles",
        safeHandler((payload) => guiService.getAdsPowerGroupProfiles(
            payload?.groupId
        ))
    );
    ipcMain.handle(
        "profiles:move",
        safeHandler((payload) => guiService.moveAdsPowerProfiles(
            payload?.profileIds,
            payload?.groupId
        ))
    );
    ipcMain.handle(
        "post:publish",
        safeHandler(async (payload) => {
            const input = {
                accountKey: String(payload.accountKey ?? ""),
                pageId: String(payload.pageId ?? ""),
                geo: String(payload.geo ?? "").trim().toUpperCase(),
                language: String(payload.language ?? "").trim().toUpperCase(),
                creativeGeo: String(payload.creativeGeo ?? payload.language ?? payload.geo ?? "").trim().toUpperCase(),
                creativeName: String(payload.creativeName ?? "").trim(),
                siteUrl: String(payload.siteUrl ?? "").trim(),
                manualCreativeText: String(payload.manualCreativeText ?? "").trim(),
                useCreativeFont: payload.useCreativeFont === true,
                creativeFont: "blurry",
                imagePath: String(payload.imagePath ?? ""),
                imagePaths: [...new Set((payload.imagePaths ?? [])
                    .map((item) => String(item ?? "").trim())
                    .filter(Boolean))],
                disableComments: payload.disableComments === true,
                commentGroupIds: [...new Set((payload.commentGroupIds ?? [])
                    .map((id) => String(id).trim())
                    .filter(Boolean))],
                commentBrowserMode: payload.commentBrowserMode === "headless"
                    ? "headless"
                    : "visible",
                commentDisableImages: payload.commentDisableImages === true,
                commentWorkerConcurrency: Math.min(5, Math.max(1, Number(payload.commentWorkerConcurrency) || 5)),
                commentWorkerProxyIds: payload.commentWorkerProxyIds ?? {},
            };
            if (!input.manualCreativeText && (!input.creativeName || !input.siteUrl)) throw Object.assign(
                new Error("Оберіть креатив і Offer URL або введіть текст креативу вручну"),
                { code: "PUBLICATION_CREATIVE_REQUIRED" }
            );
            if (!input.disableComments && !input.creativeName) throw Object.assign(
                new Error("Для коментарів оберіть креатив, з якого брати коментарі"),
                { code: "PUBLICATION_COMMENT_CREATIVE_REQUIRED" }
            );
            if (!input.disableComments && !input.commentGroupIds.length) throw Object.assign(
                new Error("Оберіть хоча б одну AdsPower-групу або вимкніть коментування"),
                { code: "PUBLICATION_COMMENTING_GROUP_REQUIRED" }
            );
            const groups = input.disableComments ? [] : await guiService.getAdsPowerGroups();
            const groupLabels = new Map(groups.map((group) => [
                String(group.groupId),
                group.groupName,
            ]));
            const task = await backgroundTaskManager.enqueue({
                type: "publication",
                name: `Публікація · ${input.geo} · ${input.creativeName}`,
                resources: [
                    {
                        key: "facebook-page-publish",
                        label: "черга публікації Facebook-постів",
                    },
                    ...input.commentGroupIds.map((groupId) => ({
                        key: `adspower-group:${groupId}`,
                        label: groupLabels.get(groupId) || `AdsPower ${groupId}`,
                    })),
                ],
                input,
                metadata: {
                    accountKey: input.accountKey,
                    pageId: input.pageId,
                    geo: input.geo,
                    language: input.language,
                    creativeName: input.creativeName,
                    manualCreativeText: Boolean(input.manualCreativeText),
                    useCreativeFont: input.useCreativeFont,
                    commentsEnabled: !input.disableComments,
                },
                runner: async ({ signal, progress, waitForAction }) => {
                    const taskProgress = async (patch) => {
                        if (signal.aborted) throw Object.assign(new Error("Публікацію скасовано"), { name: "AbortError" });
                        return progress(patch);
                    };
                    await taskProgress({ stage: "starting", completed: 0, total: input.imagePath ? 4 : 3, message: "Починаємо публікацію" });
                    const post = await guiService.publishCreativePost(input, taskProgress);
                    await updateCacheSafely(
                        () => remoteDataCacheStore.prependPost(
                            input.accountKey,
                            input.pageId,
                            {
                                id: post.postId,
                                postId: post.postId,
                                message: post.message,
                                permalinkUrl: post.permalinkUrl,
                                createdTime: post.createdTime,
                                thumbnailUrl: null,
                            }
                        ),
                        {
                            channel: "pages:posts-cache-updated",
                            payload: {
                                type: "prepend",
                                accountKey: input.accountKey,
                                pageId: input.pageId,
                                post: {
                                    id: post.postId,
                                    postId: post.postId,
                                    message: post.message,
                                    permalinkUrl: post.permalinkUrl,
                                    createdTime: post.createdTime,
                                    thumbnailUrl: null,
                                },
                            },
                        }
                    );
                    await pagePreferencesStore.updateMetadata(input.pageId, {
                        geo: input.geo,
                        language: input.language,
                        creativeName: input.creativeName,
                    });
                    let commentSummary = null;
                    if (!input.disableComments) {
                        if (!post.permalinkUrl) throw Object.assign(
                            new Error("Facebook не повернув посилання на опублікований пост для коментування"),
                            { code: "PUBLICATION_PERMALINK_REQUIRED" }
                        );
                        const workerProxies = await resolveWorkerProxies(
                            proxyManager,
                            input.commentWorkerProxyIds
                        );
                        commentSummary = await guiService.runParallelCommentingCampaign({
                            groupIds: input.commentGroupIds,
                            geo: input.geo,
                            creativeGeo: input.creativeGeo,
                            creativeName: input.creativeName,
                            siteUrl: input.siteUrl,
                            postUrl: post.permalinkUrl,
                            browserMode: input.commentBrowserMode,
                            disableImages: input.commentDisableImages,
                            // Для опублікованого поста зберігаємо вкладеність реплаїв.
                            commentTarget: "post",
                            concurrency: input.commentWorkerConcurrency,
                            workerProxies,
                            onProxyUnavailable: createProxyUnavailableHandler({
                                proxyManager,
                                progress,
                                waitForAction,
                            }),
                            signal,
                            onProgress: progress,
                        });
                    }
                    const commentPublicSummary = commentSummary
                        ? { ...commentSummary }
                        : null;
                    if (commentPublicSummary) delete commentPublicSummary.reportDetails;
                    const result = {
                        accountKey: input.accountKey,
                        pageId: input.pageId,
                        geo: input.geo,
                        language: input.language,
                        creativeName: input.creativeName,
                        siteUrl: input.siteUrl,
                        postId: post.postId,
                        permalinkUrl: post.permalinkUrl,
                        type: post.type,
                        verified: post.verified,
                        comments: commentPublicSummary,
                    };
                    if (commentSummary?.fatalError && !signal.aborted) {
                        const error = Object.assign(new Error(commentSummary.fatalError), {
                            code: "PUBLICATION_COMMENTING_FATAL_ERROR",
                        });
                        error.reportDetails = commentSummary.reportDetails;
                        throw error;
                    }
                    return {
                        result,
                        taskStatus: commentSummary && (
                            commentSummary.failedComments
                            || commentSummary.failedProfiles
                            || commentSummary.skipped
                        ) ? "completed_with_warnings" : "completed",
                        reportDetails: {
                            inputSummary: {
                                accountKey: input.accountKey,
                                pageId: input.pageId,
                                geo: input.geo,
                                creativeName: input.creativeName,
                                siteUrl: input.siteUrl,
                                manualCreativeText: Boolean(input.manualCreativeText),
                                useCreativeFont: input.useCreativeFont,
                                hasImage: Boolean(input.imagePath),
                                disableComments: input.disableComments,
                                commentGroupIds: input.commentGroupIds,
                            },
                            resultSummary: result,
                            commentReport: commentSummary?.reportDetails ?? null,
                        },
                    };
                },
            });
            return { taskId: task.id, task };
        })
    );
    ipcMain.handle(
        "comments:run",
        safeHandler(async (payload) => {
            const browserMode = payload.browserMode === "headless"
                ? "headless"
                : "visible";
            const disableImages = payload.disableImages === true;
            const commentTarget = payload.commentTarget === "ad" ? "ad" : "post";
            const groupIds = [...new Set((payload.groupIds ?? [])
                .map((id) => String(id).trim())
                .filter(Boolean))];
            if (!groupIds.length) throw Object.assign(
                new Error("Оберіть хоча б одну AdsPower-групу"),
                { code: "COMMENTING_GROUP_REQUIRED" }
            );
            const groups = await guiService.getAdsPowerGroups();
            const labels = new Map(groups.map((group) => [
                String(group.groupId),
                group.groupName,
            ]));
            const task = await backgroundTaskManager.enqueue({
                type: "comments",
                name: `${commentTarget === "ad" ? "Коментарі об’яви" : "Коментарі поста"} · ${String(payload.geo ?? "").toUpperCase()} · ${String(payload.creativeName ?? "")}`,
                resources: groupIds.map((groupId) => ({
                    key: `adspower-group:${groupId}`,
                    label: labels.get(groupId) || `AdsPower ${groupId}`,
                })),
                input: {
                    groupIds,
                    geo: payload.geo,
                    creativeGeo: payload.creativeGeo || payload.language || payload.geo,
                    language: payload.language || "",
                    creativeName: payload.creativeName,
                    siteUrl: payload.siteUrl,
                    postUrl: payload.postUrl,
                    browserMode,
                    disableImages,
                    commentTarget,
                    commentWorkerProxyIds: payload.commentWorkerProxyIds ?? {},
                },
                metadata: {
                    groupIds,
                    geo: payload.geo,
                    language: payload.language || "",
                    browserMode,
                    disableImages,
                },
                runner: async ({ signal, progress, waitForAction }) => {
                    const workerProxies = await resolveWorkerProxies(
                        proxyManager,
                        payload.commentWorkerProxyIds
                    );
                    const summary = await guiService.runParallelCommentingCampaign({
                        ...payload,
                        groupIds,
                        browserMode,
                        disableImages,
                        commentTarget,
                        concurrency: payload.commentWorkerConcurrency,
                        workerProxies,
                        onProxyUnavailable: createProxyUnavailableHandler({
                            proxyManager,
                            progress,
                            waitForAction,
                        }),
                        signal,
                        onProgress: progress,
                    });
                    const reportDetails = summary.reportDetails;
                    const publicSummary = { ...summary };
                    delete publicSummary.reportDetails;
                    if (summary.fatalError && !signal.aborted) {
                        const error = Object.assign(new Error(summary.fatalError), {
                            code: "COMMENTING_FATAL_ERROR",
                        });
                        error.reportDetails = reportDetails;
                        throw error;
                    }
                    return {
                        result: publicSummary,
                        taskStatus: summary.failedComments
                            || summary.failedProfiles
                            || summary.skipped
                            ? "completed_with_warnings"
                            : "completed",
                        reportDetails,
                    };
                },
            });
            return { taskId: task.id, task };
        })
    );
    ipcMain.handle(
        "account-setup:run",
        safeHandler(async (payload) => {
            const browserMode = payload.browserMode === "headless"
                ? "headless"
                : "visible";
            const profileNos = [...new Set((payload.profileNos ?? [])
                .map((id) => String(id).trim())
                .filter(Boolean))];
            if (!profileNos.length) {
                throw Object.assign(
                    new Error("Оберіть хоча б один профіль AdsPower"),
                    { code: "ACCOUNT_SETUP_PROFILES_REQUIRED" }
                );
            }
            const geo = String(payload.geo ?? "").replace(/\s+/g, " ").trim();
            const profileDataSources = {
                namesGeo: String(payload.namesGeo ?? "").trim().toUpperCase() || geo,
                companiesGeo: String(payload.companiesGeo ?? "").trim().toUpperCase() || geo,
                universitiesGeo: String(payload.universitiesGeo ?? "").trim().toUpperCase() || geo,
                professionsGeo: String(payload.professionsGeo ?? "").trim().toUpperCase() || geo,
            };
            const photosDirectory = String(payload.photosDirectory ?? "").trim();
            const operations = {
                changeName: payload.operations?.changeName !== false,
                changeAvatar: payload.operations?.changeAvatar !== false,
                changeCover: payload.operations?.changeCover !== false,
                deletePosts: payload.operations?.deletePosts !== false,
                publishPosts: payload.operations?.publishPosts !== false,
                fillAbout: payload.operations?.fillAbout !== false,
            };
            const task = await backgroundTaskManager.enqueue({
                type: "account-setup",
                name: `Акаунти під коментарі · ${geo} · ${profileNos.length}`,
                resources: profileNos.map((profileNo) => ({
                    key: `adspower-profile:${profileNo}`,
                    label: `AdsPower ${profileNo}`,
                })),
                input: {
                    profileNos,
                    geo,
                    maleCount: payload.maleCount,
                    femaleCount: payload.femaleCount,
                    ...profileDataSources,
                    photosDirectory,
                    operations,
                    browserMode,
                    commentWorkerProxyIds: payload.commentWorkerProxyIds ?? {},
                },
                metadata: {
                    profileNos,
                    geo,
                    browserMode,
                },
                runner: async ({ signal, progress, waitForAction }) => {
                    const workerProxies = await resolveWorkerProxies(
                        proxyManager,
                        payload.commentWorkerProxyIds
                    );
                    const summary = await guiService.runCommentAccountSetup({
                        profileNos,
                        geo,
                        maleCount: payload.maleCount,
                        femaleCount: payload.femaleCount,
                        ...profileDataSources,
                        photosDirectory,
                        operations,
                        browserMode,
                        concurrency: payload.commentWorkerConcurrency,
                        workerProxies,
                        onProxyUnavailable: createProxyUnavailableHandler({
                            proxyManager,
                            progress,
                            waitForAction,
                        }),
                        signal,
                        onProgress: progress,
                    });
                    if (summary.fatalError && !signal.aborted) {
                        const error = Object.assign(
                            new Error(summary.fatalError),
                            { code: "ACCOUNT_SETUP_FATAL_ERROR" }
                        );
                        error.reportDetails = {
                            resultSummary: summary,
                        };
                        throw error;
                    }
                    return {
                        result: summary,
                        taskStatus: summary.failed || summary.completedWithError
                            ? "completed_with_warnings"
                            : "completed",
                        reportDetails: { resultSummary: summary },
                    };
                },
            });
            return { taskId: task.id, task };
        })
    );
    ipcMain.handle(
        "tasks:list",
        safeHandler(() => backgroundTaskManager.list())
    );
    ipcMain.handle(
        "tasks:cancel",
        safeHandler(({ taskId }) => backgroundTaskManager.cancel(taskId))
    );
    ipcMain.handle(
        "tasks:dismiss",
        safeHandler(({ taskId }) => backgroundTaskManager.dismiss(taskId))
    );
    ipcMain.handle(
        "tasks:clear-finished",
        safeHandler(() => backgroundTaskManager.clearFinished())
    );
    ipcMain.handle(
        "tasks:comment-concurrency-set",
        safeHandler(({ value }) => backgroundTaskManager.setCommentConcurrency(value))
    );
    ipcMain.handle(
        "tasks:resolve-action",
        safeHandler(({ taskId, actionKey, payload }) => (
            backgroundTaskManager.resolveAction(taskId, actionKey, payload)
        ))
    );
    ipcMain.handle(
        "logs:list",
        safeHandler((payload) => logger.list(payload))
    );
    ipcMain.handle(
        "logs:scopes",
        safeHandler(() => logger.scopes())
    );
    ipcMain.handle(
        "logs:level-set",
        safeHandler(({ level }) => logger.setLevel(level))
    );
    ipcMain.handle(
        "logs:renderer-write",
        safeHandler(({ level, event, message, fields }) => {
            const method = ["debug", "info", "warn", "error"].includes(level)
                ? level
                : "info";
            return logger.child("renderer")[method](event, message, fields);
        })
    );
    ipcMain.handle(
        "reports:list",
        safeHandler((payload) => reportManager.list(payload))
    );
    ipcMain.handle(
        "reports:get",
        safeHandler(async ({ reportId }) => {
            const report = await reportManager.get(reportId);
            if (!report) throw Object.assign(new Error("Звіт не знайдено"), { code: "REPORT_NOT_FOUND" });
            return report;
        })
    );
    ipcMain.handle(
        "reports:delete",
        safeHandler(({ reportId }) => reportManager.delete(reportId))
    );
    ipcMain.handle(
        "reports:export-markdown",
        safeHandler(async ({ reportId }) => {
            const report = await reportManager.get(reportId);
            if (!report) throw Object.assign(new Error("Звіт не знайдено"), { code: "REPORT_NOT_FOUND" });
            const result = await dialog.showSaveDialog(getWindow(), {
                title: "Експортувати звіт",
                defaultPath: `${report.title.replace(/[^A-Za-zА-Яа-яІіЇїЄє0-9_-]+/g, "-")}.md`,
                filters: [{ name: "Markdown", extensions: ["md"] }],
            });
            if (result.canceled || !result.filePath) return null;
            await reportManager.exportMarkdown(reportId, result.filePath);
            return true;
        })
    );
    ipcMain.handle(
        "reports:markdown-list",
        safeHandler(async ({ query = "", type, dateFrom, dateTo } = {}) => {
            const needle = String(query).trim().toLocaleLowerCase();
            const from = dateFrom ? new Date(dateFrom) : null;
            const to = dateTo ? new Date(dateTo) : null;
            const entries = await readdir(appPaths.reports, { withFileTypes: true }).catch((error) => {
                if (error.code === "ENOENT") return [];
                throw error;
            });
            const reports = await Promise.all(entries
                .filter((entry) => entry.isFile() && markdownReportPattern.test(entry.name))
                .map(async (entry) => {
                    const filePath = path.join(appPaths.reports, entry.name);
                    const info = await stat(filePath);
                    const reportType = markdownReportType(entry.name);
                    const content = needle ? await readFile(filePath, "utf8") : "";
                    return {
                        id: entry.name,
                        type: reportType,
                        title: markdownReportTitle(reportType),
                        createdAt: info.mtime.toISOString(),
                        matches: !needle || `${entry.name} ${content}`.toLocaleLowerCase().includes(needle),
                    };
                }));
            return reports.filter((report) => (
                (!type || report.type === type)
                && (!from || new Date(report.createdAt) >= from)
                && (!to || new Date(report.createdAt) <= to)
                && report.matches
            )).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
                .map(({ matches, ...report }) => report);
        })
    );
    ipcMain.handle(
        "reports:markdown-get",
        safeHandler(async ({ reportId }) => {
            const fileName = markdownReportFileName(reportId);
            const filePath = path.join(appPaths.reports, fileName);
            let content;
            try {
                content = await readFile(filePath, "utf8");
            } catch (error) {
                if (error.code === "ENOENT") {
                    throw Object.assign(new Error("Звіт не знайдено"), { code: "REPORT_NOT_FOUND" });
                }
                throw error;
            }
            const info = await stat(filePath);
            const type = markdownReportType(fileName);
            return {
                id: fileName,
                type,
                title: markdownReportTitle(type),
                createdAt: info.mtime.toISOString(),
                content,
                filePath,
            };
        })
    );
    ipcMain.handle(
        "templates:list",
        safeHandler(() => templateManager.list())
    );
    ipcMain.handle(
        "countries:list",
        safeHandler(() => countryCatalog.list())
    );
    ipcMain.handle(
        "languages:list",
        safeHandler(() => languageCatalog.list())
    );
    ipcMain.handle(
        "templates:create",
        safeHandler((payload) => templateManager.create(payload))
    );
    ipcMain.handle(
        "templates:update",
        safeHandler(({ id, ...payload }) => templateManager.update(id, payload))
    );
    ipcMain.handle(
        "templates:duplicate",
        safeHandler(({ id }) => templateManager.duplicate(id))
    );
    ipcMain.handle(
        "templates:delete",
        safeHandler(({ id }) => templateManager.delete(id))
    );
    ipcMain.handle(
        "keitaro:groups-list",
        safeHandler((options) => {
            if (!keitaroGuiService) {
                const error = new Error("Сервіс Keitaro не підключено");
                error.code = "KEITARO_UNAVAILABLE";
                throw error;
            }
            return keitaroGuiService.listCampaignGroups();
        })
    );
    ipcMain.handle(
        "keitaro:campaigns-report",
        safeHandler((payload) => {
            if (!keitaroGuiService) {
                const error = new Error("Сервіс Keitaro не підключено");
                error.code = "KEITARO_UNAVAILABLE";
                throw error;
            }
            return keitaroGuiService.getCampaignsReport(payload);
        })
    );
    ipcMain.handle(
        "keitaro:campaigns-list",
        safeHandler((payload) => {
            if (!keitaroGuiService) {
                const error = new Error("Сервіс Keitaro не підключено");
                error.code = "KEITARO_UNAVAILABLE";
                throw error;
            }
            return keitaroGuiService.getCampaignsList(payload);
        })
    );
    ipcMain.handle(
        "keitaro:campaigns-stats",
        safeHandler((payload) => {
            if (!keitaroGuiService) {
                const error = new Error("Сервіс Keitaro не підключено");
                error.code = "KEITARO_UNAVAILABLE";
                throw error;
            }
            return keitaroGuiService.getCampaignStats(payload);
        })
    );
    ipcMain.handle(
        "keitaro:campaigns-move",
        safeHandler((payload) => keitaroGuiService.moveCampaignsToGroup(payload))
    );
    ipcMain.handle(
        "keitaro:campaigns-pixel-change",
        safeHandler(async ({ campaignIds = [], pixelId } = {}) => {
            const settings = await keitaroCampaignSettingsManager.get();
            const pixel = settings.pixels.find((item) => String(item.id) === String(pixelId));
            if (!pixel) throw new Error("Піксель не знайдено в налаштуваннях Keitaro");
            return keitaroGuiService.changeCampaignPixels({
                campaignIds,
                pixelId: pixel.pixelId,
                pixelToken: pixel.token,
            });
        })
    );
    ipcMain.handle(
        "keitaro:campaigns-domain-change",
        safeHandler(async ({ campaignIds = [], domainMappingId } = {}) => {
            const settings = await keitaroCampaignSettingsManager.get();
            const mapping = settings.domainMappings.find((item) => String(item.id) === String(domainMappingId));
            if (!mapping) throw new Error("Домен не знайдено в налаштуваннях Keitaro");
            return keitaroGuiService.changeCampaignDomains({ campaignIds, domainId: mapping.domainId });
        })
    );
    ipcMain.handle(
        "keitaro:landing-pages-list",
        safeHandler((options) => {
            if (!keitaroGuiService) {
                const error = new Error("Сервіс Keitaro не підключено");
                error.code = "KEITARO_UNAVAILABLE";
                throw error;
            }
            return keitaroGuiService.listLandingPages(options);
        })
    );
    ipcMain.handle(
        "keitaro:offers-list",
        safeHandler((options) => {
            if (!keitaroGuiService) {
                const error = new Error("Сервіс Keitaro не підключено");
                error.code = "KEITARO_UNAVAILABLE";
                throw error;
            }
            return keitaroGuiService.listOffers(options);
        })
    );
    ipcMain.handle(
        "keitaro:offers-report",
        safeHandler((payload) => keitaroGuiService.getOffersReport(payload))
    );
    ipcMain.handle(
        "keitaro:offers-move",
        safeHandler((payload) => keitaroGuiService.moveOffersToGroup(payload))
    );
    ipcMain.handle(
        "keitaro:asset-groups-list",
        safeHandler(({ kind }) => keitaroGuiService.listAssetGroups(kind))
    );
    ipcMain.handle(
        "keitaro:countries-list",
        safeHandler(() => keitaroGuiService.listCountries())
    );
    ipcMain.handle(
        "keitaro:domains-list",
        safeHandler(() => keitaroGuiService.listDomains())
    );
    ipcMain.handle(
        "keitaro:traffic-sources-list",
        safeHandler(() => keitaroGuiService.listTrafficSources())
    );
    ipcMain.handle(
        "keitaro-stream-templates:list",
        safeHandler(() => keitaroStreamTemplateManager.list())
    );
    ipcMain.handle(
        "keitaro-stream-templates:create",
        safeHandler((payload) => keitaroStreamTemplateManager.create(payload))
    );
    ipcMain.handle(
        "keitaro-stream-templates:update",
        safeHandler(({ id, ...payload }) => keitaroStreamTemplateManager.update(id, payload))
    );
    ipcMain.handle(
        "keitaro-stream-templates:duplicate",
        safeHandler(({ id }) => keitaroStreamTemplateManager.duplicate(id))
    );
    ipcMain.handle(
        "keitaro-stream-templates:delete",
        safeHandler(({ id }) => keitaroStreamTemplateManager.delete(id))
    );
    ipcMain.handle(
        "keitaro-stream-templates:offers-refresh",
        safeHandler(async () => keitaroStreamTemplateManager.refreshOfferNames(
            await keitaroGuiService.listOffers({ forceRefresh: true })
        ))
    );
    ipcMain.handle(
        "keitaro-stream-templates:apply",
        safeHandler(async ({ templateId, campaignIds, mode, replacePosition }) => {
            const template = await keitaroStreamTemplateManager.get(templateId);
            return keitaroGuiService.applyStreamTemplate({
                campaignIds,
                stream: template.stream,
                mode,
                replacePosition,
            });
        })
    );
    ipcMain.handle(
        "keitaro-campaign-settings:get",
        safeHandler(() => keitaroCampaignSettingsManager.get())
    );
    ipcMain.handle(
        "keitaro-campaign-settings:save",
        safeHandler((payload) => keitaroCampaignSettingsManager.save(payload))
    );
    ipcMain.handle(
        "keitaro:campaign-create",
        safeHandler(async ({ streamTemplateId, ...payload }) => {
            const streamTemplate = streamTemplateId
                ? await keitaroStreamTemplateManager.get(streamTemplateId)
                : null;
            return keitaroGuiService.createCampaignWithWhiteStream({
                ...payload,
                streamTemplate,
            });
        })
    );
    ipcMain.handle(
        "keitaro-stream-templates:apply-to-matching-streams",
        safeHandler(async ({ templateId }) => {
            const template = await keitaroStreamTemplateManager.get(templateId);
            return keitaroGuiService.applyStreamTemplateToMatchingStreams({
                stream: template.stream,
                streamName: template.name,
            });
        })
    );
    ipcMain.handle(
        "spend:overview",
        safeHandler(() => {
            if (!spendService) throw Object.assign(
                new Error("Сервіс спенду не підключено"),
                { code: "SPEND_UNAVAILABLE" }
            );
            return spendService.getOverview();
        })
    );
    ipcMain.handle(
        "spend:settings-get",
        safeHandler(() => spendService.getSettings())
    );
    ipcMain.handle(
        "spend:settings-save",
        safeHandler(async (payload) => {
            const settings = spendService.saveSettings(payload);
            await spendScheduler?.checkNow();
            return settings;
        })
    );
    ipcMain.handle(
        "spend:collect-start",
        safeHandler(() => spendTaskCoordinator.enqueueCollection())
    );
    ipcMain.handle(
        "spend:export-start",
        safeHandler(() => spendTaskCoordinator.enqueueExport())
    );
    ipcMain.handle(
        "state:load",
        safeHandler(() => appStateStore.load())
    );
    ipcMain.handle(
        "state:save",
        safeHandler(async (payload) => {
            const saved = await appStateStore.save(payload);
            keitaroGuiService?.setConcurrency(saved.keitaroConcurrency);
            return saved;
        })
    );
    ipcMain.handle(
        "app:set-zoom",
        safeHandler(({ scale }) => {
            const requestedScale = Number(scale);
            const normalizedScale = Number.isFinite(requestedScale)
                ? Math.min(1.5, Math.max(0.8, requestedScale))
                : 1.3;
            const window = getWindow();

            if (!window || window.isDestroyed?.()) {
                const error = new Error("Головне вікно програми недоступне");
                error.code = "APP_WINDOW_UNAVAILABLE";
                throw error;
            }

            window.webContents.setZoomFactor(normalizedScale);
            return normalizedScale;
        })
    );
    ipcMain.handle(
        "dialog:select-image",
        safeHandler(async () => {
            const result = await dialog.showOpenDialog(getWindow(), {
                title: "Виберіть картинку для Facebook-поста",
                properties: ["openFile"],
                filters: [{
                    name: "Зображення",
                    extensions: ["jpg", "jpeg", "png", "webp"],
                }],
            });
            return result.canceled ? null : result.filePaths[0] ?? null;
        })
    );
    ipcMain.handle(
        "dialog:select-images",
        safeHandler(async () => {
            const result = await dialog.showOpenDialog(getWindow(), {
                title: "Виберіть фотографії для Facebook-поста",
                properties: ["openFile", "multiSelections"],
                filters: [{
                    name: "Зображення",
                    extensions: ["jpg", "jpeg", "png", "webp"],
                }],
            });
            return result.canceled ? [] : result.filePaths;
        })
    );
    ipcMain.handle(
        "dialog:select-page-rebuild-images",
        safeHandler(async () => {
            const result = await dialog.showOpenDialog(getWindow(), {
                title: "Виберіть папку для пересетаплення фанпейджа",
                properties: ["openFile", "multiSelections"],
                filters: [{
                    name: "Зображення",
                    extensions: ["jpg", "jpeg", "png", "webp"],
                }],
            });
            return result.canceled ? [] : result.filePaths;
        })
    );
    ipcMain.handle(
        "dialog:select-account-photos-folder",
        safeHandler(async (payload = {}) => {
            const requested = String(payload.defaultPath ?? "").trim();
            const options = {
                title: "Виберіть папку з фото для акаунтів",
                properties: ["openDirectory"],
            };
            if (requested) {
                try {
                    if ((await stat(requested)).isDirectory()) {
                        options.defaultPath = requested;
                    }
                } catch {
                    // Якщо старої папки вже немає — відкриваємо звичайний вибір.
                }
            }
            const result = await dialog.showOpenDialog(getWindow(), options);
            return result.canceled ? null : result.filePaths[0] ?? null;
        })
    );
    ipcMain.handle(
        "app:open-path",
        safeHandler(async ({ filePath }) => {
            const resolved = path.resolve(String(filePath ?? ""));
            const reportsRoot = appPaths.reports;
            if (
                resolved !== reportsRoot
                && !resolved.startsWith(`${reportsRoot}${path.sep}`)
            ) {
                const error = new Error("Можна відкривати лише файли зі звітів");
                error.code = "PATH_NOT_ALLOWED";
                throw error;
            }
            const openError = await shell.openPath(resolved);
            if (openError) {
                throw new Error(openError);
            }
            return true;
        })
    );
    ipcMain.handle(
        "app:open-external",
        safeHandler(async ({ url }) => {
            const parsed = new URL(String(url ?? ""));
            const facebookHost = parsed.hostname === "facebook.com"
                || parsed.hostname.endsWith(".facebook.com");

            if (parsed.protocol !== "https:" || !facebookHost) {
                const error = new Error(
                    "Дозволено відкривати лише HTTPS-посилання Facebook"
                );
                error.code = "EXTERNAL_URL_NOT_ALLOWED";
                throw error;
            }

            await shell.openExternal(parsed.href);
            return true;
        })
    );
}


export { serializeError };
