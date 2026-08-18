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
        safeHandler(({ accountKey }) => guiService.getAdAccounts(accountKey))
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
