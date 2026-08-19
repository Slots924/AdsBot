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
    getWindow,
}) {
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

    const runCreationJob = async (job) => {
        const template = await templateManager.get(job.input.templateId);
        const onProgress = async (progress) => {
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
                status: "failed",
                stage: error.stage ?? "unknown",
                objects: error.createdObjects ?? job.objects,
                errors: [safeError],
            });
            sendCampaignProgress({
                jobId: job.id,
                stage: "failed",
                error: safeError,
            });
            error.jobId = job.id;
            throw error;
        }
    };

    ipcMain.handle(
        "accounts:list",
        safeHandler(() => guiService.getAccounts())
    );
    ipcMain.handle(
        "accounts:refresh",
        safeHandler(() => guiService.refreshAccounts())
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
            return runCreationJob(job);
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
            const running = await campaignCreationJournal.update(job.id, {
                status: "running",
                errors: [],
            });
            return runCreationJob(running);
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
            const result = await guiService.deleteCampaignDraft({
                accountKey: job.input.accountKey,
                objects: job.objects,
            }, (progress) => {
                sendCampaignProgress({
                    jobId: job.id,
                    stage: "cleanup",
                    ...progress,
                });
            });
            await campaignCreationJournal.update(job.id, {
                status: result.failed.length ? "cleanup-partial" : "deleted",
                stage: "cleanup",
            });
            return result;
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
        safeHandler((payload) => guiService.runCommentingCampaign(payload))
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
