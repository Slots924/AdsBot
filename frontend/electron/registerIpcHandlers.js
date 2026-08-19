function safeMessage(value) {
    return String(value || "Невідома помилка")
        .replace(/EAA[A-Za-z0-9]+/g, "[REDACTED]")
        .replace(/((?:access_)?token|cookie)=([^&\s]+)/gi, "$1=[REDACTED]");
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


function safeHandler(handler) {
    return async (event, payload) => {
        try {
            return {
                ok: true,
                data: await handler(payload ?? {}, event),
            };
        } catch (error) {
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
    countryCatalog,
    campaignCreationJournal,
    backgroundTaskManager,
    facebookAccountManager,
    getWindow,
}) {
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
                };
            },
        });
        return { taskId: task.id, task, jobId: job.id };
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
    ipcMain.handle(
        "pages:list",
        safeHandler(({ accountKey }) => guiService.getFanPages(accountKey))
    );
    ipcMain.handle(
        "ads:list",
        safeHandler(async ({ accountKey }) => {
            const accounts = await guiService.getAdAccounts(accountKey);
            return adAccountPreferencesStore.enrichAccounts(
                accountKey,
                accounts
            );
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
        safeHandler(({ accountKey, adAccountId, datePreset }) => (
            guiService.getAdCampaigns(
                accountKey,
                adAccountId,
                datePreset
            )
        ))
    );
    ipcMain.handle(
        "campaigns:posts-list",
        safeHandler((payload) => guiService.getPagePosts(payload))
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
        safeHandler((payload) => guiService.publishCreativePost(payload))
    );
    ipcMain.handle(
        "comments:run",
        safeHandler(async (payload) => {
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
                },
                metadata: { groupIds, geo: payload.geo },
                runner: async ({ signal, progress }) => {
                    const summary = await guiService.runCommentingCampaign({
                        ...payload,
                        groupIds,
                        signal,
                        onProgress: progress,
                    });
                    if (summary.fatalError && !signal.aborted) {
                        throw Object.assign(new Error(summary.fatalError), {
                            code: "COMMENTING_FATAL_ERROR",
                        });
                    }
                    return {
                        result: summary,
                        taskStatus: summary.failedComments
                            || summary.failedProfiles
                            || summary.skipped
                            ? "completed_with_warnings"
                            : "completed",
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
