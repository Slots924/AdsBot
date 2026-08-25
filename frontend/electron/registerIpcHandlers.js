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
    campaignCreationJournal,
    backgroundTaskManager,
    facebookAccountManager,
    proxyManager,
    checkProxyFn = checkProxy,
    refreshProxyIpFn = refreshProxyIp,
    logger,
    reportManager,
    getWindow,
}) {
    const safeHandler = (handler) => createSafeHandler(handler, logger?.child("ipc"));
    const workspaceRefreshes = new Map();
    const campaignRefreshes = new Map();
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

    const loadRemoteCampaigns = async ({
        accountKey,
        adAccountId,
        datePreset,
    }) => {
        const data = await guiService.getAdCampaigns(
            accountKey,
            adAccountId,
            datePreset
        );
        await remoteDataCacheStore.setCampaigns(
            accountKey,
            adAccountId,
            datePreset,
            data
        );
        return data;
    };

    const refreshCampaignsOnce = (payload) => {
        const key = [
            payload.accountKey,
            payload.adAccountId,
            payload.datePreset || "today",
        ].join("::");
        if (campaignRefreshes.has(key)) return campaignRefreshes.get(key);
        const refresh = loadRemoteCampaigns(payload)
            .then((data) => {
                sendRendererEvent("campaigns:refreshed", {
                    ...payload,
                    datePreset: payload.datePreset || "today",
                    data,
                });
                return data;
            })
            .catch((error) => {
                logger?.warn(
                    "cache.campaigns.refresh-failed",
                    `Не вдалося фоново оновити кампанії ${payload.adAccountId}`,
                    { error }
                );
                return null;
            });
        campaignRefreshes.set(key, refresh);
        return refresh;
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
            return {
                ...stored,
                ...(graphByKey.get(stored.accountKey) ?? {
                    status: "error",
                    error: { message: "Акаунт не завантажено" },
                }),
                archived: false,
            };
        });
    };

    const refreshManagedAccounts = async () => mergeAccountStates(
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
                        guiService.prepareCreative({ geo: draft.geo, creativeName: draft.creativeName, siteUrl: draft.siteUrl }),
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
                        message: prepared.creative, imagePath: draft.imagePath,
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
                    await pagePreferencesStore.updateMetadata(draft.pageId, { geo: draft.geo, creativeName: draft.creativeName });
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
                                geo: draft.geo, creativeName: draft.creativeName,
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
        safeHandler(async () => mergeAccountStates(
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
            await facebookAccountManager.update(accountKey, patch);
            return refreshManagedAccounts();
        })
    );
    ipcMain.handle(
        "accounts:archive-set",
        safeHandler(async ({ accountKey, archived }) => {
            await facebookAccountManager.setArchived(accountKey, archived);
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
            refreshWorkspaceOnce(accountKey);
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
                pageCreatedAt: payload.pageCreatedAt ?? null,
            },
            metadata: { accountKey, pageId },
            runner: async ({ signal, progress }) => {
                const result = await guiService.rebuildPageFromFolder({
                    accountKey,
                    pageId,
                    imagesDirectory: payload.imagesDirectory,
                    pageCreatedAt: payload.pageCreatedAt,
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
            const accounts = await guiService.getAdAccounts(accountKey);
            const enriched = await adAccountPreferencesStore.enrichAccounts(
                accountKey,
                accounts
            );
            await remoteDataCacheStore.setWorkspacePart(accountKey, {
                adAccounts: enriched,
            });
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
            const cached = await remoteDataCacheStore.getCampaigns(
                accountKey,
                adAccountId,
                datePreset
            );
            if (!cached) return loadRemoteCampaigns(payload);
            refreshCampaignsOnce(payload);
            return cached.value;
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
        "post:publish",
        safeHandler(async (payload) => {
            const input = {
                accountKey: String(payload.accountKey ?? ""),
                pageId: String(payload.pageId ?? ""),
                geo: String(payload.geo ?? "").trim().toUpperCase(),
                creativeName: String(payload.creativeName ?? "").trim(),
                siteUrl: String(payload.siteUrl ?? "").trim(),
                imagePath: String(payload.imagePath ?? ""),
            };
            const task = await backgroundTaskManager.enqueue({
                type: "publication",
                name: `Публікація · ${input.geo} · ${input.creativeName}`,
                resources: [{
                    key: "facebook-page-publish",
                    label: "черга публікації Facebook-постів",
                }],
                input,
                metadata: {
                    accountKey: input.accountKey,
                    pageId: input.pageId,
                    geo: input.geo,
                    creativeName: input.creativeName,
                },
                runner: async ({ signal, progress }) => {
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
                        creativeName: input.creativeName,
                    });
                    const result = {
                        accountKey: input.accountKey,
                        pageId: input.pageId,
                        geo: input.geo,
                        creativeName: input.creativeName,
                        siteUrl: input.siteUrl,
                        postId: post.postId,
                        permalinkUrl: post.permalinkUrl,
                        type: post.type,
                        verified: post.verified,
                    };
                    return {
                        result,
                        reportDetails: {
                            inputSummary: {
                                accountKey: input.accountKey,
                                pageId: input.pageId,
                                geo: input.geo,
                                creativeName: input.creativeName,
                                siteUrl: input.siteUrl,
                                hasImage: Boolean(input.imagePath),
                            },
                            resultSummary: result,
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
                name: `Коментарі · ${String(payload.geo ?? "").toUpperCase()} · ${String(payload.creativeName ?? "")}`,
                resources: groupIds.map((groupId) => ({
                    key: `adspower-group:${groupId}`,
                    label: labels.get(groupId) || `AdsPower ${groupId}`,
                })),
                input: {
                    groupIds,
                    geo: payload.geo,
                    creativeName: payload.creativeName,
                    siteUrl: payload.siteUrl,
                    postUrl: payload.postUrl,
                    browserMode,
                    disableImages,
                    commentWorkerProxyIds: payload.commentWorkerProxyIds ?? {},
                },
                metadata: {
                    groupIds,
                    geo: payload.geo,
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
        "templates:list",
        safeHandler(() => templateManager.list())
    );
    ipcMain.handle(
        "countries:list",
        safeHandler(() => countryCatalog.list())
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
        "state:load",
        safeHandler(() => appStateStore.load())
    );
    ipcMain.handle(
        "state:save",
        safeHandler((payload) => appStateStore.save(payload))
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
        "dialog:select-page-rebuild-folder",
        safeHandler(async () => {
            const result = await dialog.showOpenDialog(getWindow(), {
                title: "Виберіть папку для пересетаплення фанпейджа",
                properties: ["openDirectory"],
            });
            return result.canceled ? null : result.filePaths[0] ?? null;
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
