function serializeError(error) {
    return {
        message: String(error?.message || "Невідома помилка"),
        code: error?.code ?? null,
        httpStatus: error?.httpStatus ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
    };
}


function safeHandler(handler) {
    return async (_event, payload) => {
        try {
            return {
                ok: true,
                data: await handler(payload ?? {}),
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
    getWindow,
}) {
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
