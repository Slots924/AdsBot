import AdsPower from "../../classes/AdsPower.js";
import FacebookBackendService
    from "../../facebook/services/FacebookBackendService.js";
import runCommentingScenario
    from "../../scenarios/runCommentingScenario.js";
import AdsPowerGroupService
    from "../adspower/AdsPowerGroupService.js";
import CreativeManager from "../creatives/CreativeManager.js";
import { prepareCommentsForCampaign }
    from "../creatives/prepareCreativeForCampaign.js";


const disableReasons = new Map([
    [0, "Причину не вказано"],
    [1, "Порушення рекламної політики або перевірка цілісності"],
    [2, "Перевірка рекламної політики"],
    [3, "Ризик або проблема з оплатою"],
    [4, "Вимкнений сірий акаунт"],
    [5, "Додаткова перевірка Meta"],
    [6, "Перевірка цілісності бізнесу"],
    [7, "Рекламний акаунт закрито назавжди"],
    [8, "Неактивний акаунт реселера"],
    [9, "Вимкнено через тривалу неактивність"],
    [10, "Обмеження UMG"],
    [11, "Порушення політики цілісності Business Manager"],
    [12, "Неправдиве представлення рекламного акаунта"],
    [13, "Відсутній ідентифікатор юридичної особи"],
]);


function createGuiError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function normalizeLogger(logger) {
    return {
        info: typeof logger?.info === "function"
            ? logger.info.bind(logger)
            : console.info.bind(console),
        warn: typeof logger?.warn === "function"
            ? logger.warn.bind(logger)
            : console.warn.bind(console),
        error: typeof logger?.error === "function"
            ? logger.error.bind(logger)
            : console.error.bind(console),
    };
}


function formatAdAccount(account) {
    const accountStatus = Number(account.accountStatus);
    const disableReasonCode = account.disableReason === null
        ? null
        : Number(account.disableReason);

    return {
        id: account.id,
        accountId: account.accountId,
        name: account.name || "Без назви",
        accountStatus,
        status: accountStatus === 1
            ? "active"
            : accountStatus === 2
            ? "disabled"
            : "other",
        disableReason: {
            code: disableReasonCode,
            label: disableReasonCode === null
                ? "Не вказано"
                : disableReasons.get(disableReasonCode)
                    ?? `Невідома причина Meta (${disableReasonCode})`,
        },
        currency: account.currency ?? null,
        timezoneName: account.timezoneName ?? null,
        createdTime: account.createdTime ?? null,
        amountSpent: account.amountSpent ?? null,
        balance: account.balance ?? null,
        spendCap: account.spendCap ?? null,
        defaultDsaBeneficiary: account.defaultDsaBeneficiary ?? null,
        defaultDsaPayor: account.defaultDsaPayor ?? null,
        owner: account.owner ?? null,
        business: account.business ?? null,
    };
}


function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}


function formatCampaigns({ campaigns = [], insights = [] }) {
    const insightByCampaignId = new Map(
        insights.map((insight) => [String(insight.campaignId), insight])
    );

    return campaigns
        .filter((campaign) => ["ACTIVE", "PAUSED"].includes(
            String(campaign.effectiveStatus ?? "").toUpperCase()
        ))
        .map((campaign) => {
            const insight = insightByCampaignId.get(String(campaign.id));
            const leadAction = insight?.actions?.find(
                (action) => action.action_type === "lead"
            );
            const leads = numberOrZero(leadAction?.value);
            const spend = numberOrZero(insight?.spend);

            return {
                id: campaign.id,
                name: campaign.name || "Без назви",
                status: campaign.status ?? null,
                effectiveStatus: campaign.effectiveStatus ?? null,
                leads,
                spend,
                costPerLead: leads > 0 ? spend / leads : null,
            };
        })
        .sort((left, right) => {
            const activeDifference = Number(
                right.effectiveStatus === "ACTIVE"
            ) - Number(left.effectiveStatus === "ACTIVE");
            return activeDifference || left.name.localeCompare(
                right.name,
                "uk-UA",
                { numeric: true, sensitivity: "base" }
            );
        });
}


export default class AdsBotGuiService {
    #facebookBackend;
    #facebookBackendFactory;
    #facebookBackendOptions;
    #creativeManager;
    #creativeManagerFactory;
    #runCommentingScenario;
    #accountStatuses = new Map();


    constructor({
        facebookBackend,
        facebookBackendFactory = FacebookBackendService.create,
        facebookBackendOptions = {},
        adsPowerGroupService,
        adsPower,
        creativeManager = null,
        creativeManagerFactory = () => new CreativeManager(),
        runCommentingScenarioFn = runCommentingScenario,
        reportsDirectory = "./data/reports",
        logger,
    } = {}) {
        if (!facebookBackend) {
            throw createGuiError(
                "Не передано FacebookBackendService",
                "GUI_BACKEND_CONFIG_ERROR"
            );
        }

        this.#facebookBackend = facebookBackend;
        this.#facebookBackendFactory = facebookBackendFactory;
        this.#facebookBackendOptions = facebookBackendOptions;
        this.adsPower = adsPower;
        this.adsPowerGroupService = adsPowerGroupService;
        this.#creativeManager = creativeManager;
        this.#creativeManagerFactory = creativeManagerFactory;
        this.#runCommentingScenario = runCommentingScenarioFn;
        this.reportsDirectory = reportsDirectory;
        this.logger = normalizeLogger(logger);
    }


    static async create({
        facebookBackendFactory = FacebookBackendService.create,
        facebookBackendOptions = {},
        adsPower = new AdsPower(),
        groupsFile,
        ...options
    } = {}) {
        const facebookBackend = await facebookBackendFactory(
            facebookBackendOptions
        );
        const adsPowerGroupService = new AdsPowerGroupService({
            adsPower,
            ...(groupsFile ? { groupsFile } : {}),
        });

        return new AdsBotGuiService({
            ...options,
            facebookBackend,
            facebookBackendFactory,
            facebookBackendOptions,
            adsPower,
            adsPowerGroupService,
        });
    }


    async getAccounts() {
        this.logger.info("Перевіряємо Facebook-акаунти…");
        const accounts = await this.#facebookBackend.getAccounts();
        this.#accountStatuses = new Map(
            accounts.map((account) => [account.accountKey, account.status])
        );
        return accounts;
    }


    async refreshAccounts() {
        this.logger.info("Перечитуємо accounts.json і оновлюємо статуси…");
        const candidate = await this.#facebookBackendFactory(
            this.#facebookBackendOptions
        );
        const accounts = await candidate.getAccounts();

        this.#facebookBackend = candidate;
        this.#accountStatuses = new Map(
            accounts.map((account) => [account.accountKey, account.status])
        );
        this.logger.info(`Оновлено Facebook-акаунтів: ${accounts.length}`);
        return accounts;
    }


    async #assertActiveAccount(accountKey) {
        if (!this.#accountStatuses.has(accountKey)) {
            await this.getAccounts();
        }

        if (this.#accountStatuses.get(accountKey) !== "active") {
            throw createGuiError(
                "Facebook-акаунт неактивний або його статус не перевірено",
                "FACEBOOK_ACCOUNT_NOT_ACTIVE"
            );
        }
    }


    async getFanPages(accountKey) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(`Завантажуємо фанпейджі: ${accountKey}`);
        const fanPages = await this.#facebookBackend.getFanPages(accountKey);
        this.logger.info(`Знайдено доступних фанпейджів: ${fanPages.length}`);
        return fanPages;
    }


    async getAdAccounts(accountKey) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(`Завантажуємо рекламні акаунти: ${accountKey}`);
        const accounts = await this.#facebookBackend.getAdAccounts(accountKey);
        return accounts.map(formatAdAccount);
    }


    async getAdCampaigns(accountKey, adAccountId, datePreset = "today") {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(
            `Завантажуємо кампанії ${adAccountId} за період ${datePreset}…`
        );
        const result = await this.#facebookBackend.getAdCampaigns(
            accountKey,
            adAccountId,
            datePreset
        );
        const campaigns = formatCampaigns(result);
        this.logger.info(`Знайдено кампаній: ${campaigns.length}`);
        return {
            adAccountId,
            datePreset,
            campaigns,
        };
    }


    async getPagePosts({ accountKey, pageId, limit = 10 } = {}) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(`Завантажуємо нові пости фанпейджі ${pageId}…`);
        return this.#facebookBackend.getPagePosts(accountKey, {
            pageId,
            limit,
        });
    }


    async preflightLeadCampaign({ accountKey, ...options } = {}) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info("Перевіряємо кампанію, доступи та ресурси Meta…");
        return this.#facebookBackend.preflightLeadCampaign(
            accountKey,
            options
        );
    }


    async createLeadCampaign({ accountKey, ...options } = {}, onProgress) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(
            `Створюємо lead-кампанію в ${options.adAccountId}…`
        );
        return this.#facebookBackend.createLeadCampaign(
            accountKey,
            options,
            onProgress
        );
    }


    async deleteCampaignDraft({ accountKey, objects } = {}, onProgress) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info("Видаляємо PAUSED-чернетку кампанії…");
        return this.#facebookBackend.deleteCampaignDraft(
            accountKey,
            objects,
            onProgress
        );
    }


    async getAdsPowerGroups() {
        return this.adsPowerGroupService.getGroups();
    }


    async refreshAdsPowerGroups() {
        this.logger.info("Отримуємо всі профілі через AdsPower Profile API V2…");
        const groups = await this.adsPowerGroupService.refreshGroups();
        this.logger.info(`Оновлено груп AdsPower: ${groups.length}`);
        return groups;
    }


    async publishCreativePost({
        accountKey,
        pageId,
        geo,
        creativeName,
        siteUrl,
        imagePath = "",
    } = {}) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(
            `Отримуємо або генеруємо креатив ${geo} ${creativeName}; це може тривати декілька хвилин…`
        );
        const preparedCreative = await this.#facebookBackend.prepareCreative({
            geo,
            creativeName,
            siteUrl,
        });

        this.logger.info("Надсилаємо пост у Facebook…");
        const post = await this.#facebookBackend.publishPost({
            accountKey,
            pageId,
            message: preparedCreative.creative,
            imagePath,
        });
        this.logger.info(`Пост підтверджено: ${post.postId}`);
        return post;
    }


    async runCommentingCampaign(options = {}) {
        return this.#runCommentingCampaign(options);
    }


    async #runCommentingCampaign({
        groupIds,
        geo,
        creativeName,
        siteUrl = "",
        postUrl,
        signal,
        onProgress,
    }) {
        const progress = async (payload) => {
            if (typeof onProgress === "function") await onProgress(payload);
        };
        const assertNotAborted = () => {
            if (!signal?.aborted) return;
            throw Object.assign(new Error("Задачу коментування перервано"), {
                name: "AbortError",
                code: "COMMENTING_ABORTED",
            });
        };
        if (!this.#creativeManager) {
            this.#creativeManager = this.#creativeManagerFactory();
        }

        assertNotAborted();
        await progress({ stage: "creative", message: "Готуємо коментарі" });
        this.logger.info(
            `Отримуємо або генеруємо коментарі ${geo} ${creativeName}; це може тривати декілька хвилин…`
        );
        const creative = await this.#creativeManager.getCreative(
            geo,
            creativeName
        );
        const comments = prepareCommentsForCampaign({
            creative,
            siteUrl,
        });
        assertNotAborted();
        const result = await this.#runCommentingScenario({
            adsPower: this.adsPower,
            groupIds,
            comments,
            geo,
            creativeName,
            postUrl,
            reportsDirectory: this.reportsDirectory,
            logger: this.logger,
            signal,
            onProgress: progress,
        });

        const summary = {
            published: result.report.published.length,
            skipped: result.report.skipped.length,
            failedComments: result.report.failedComments.length,
            failedProfiles: result.report.failedProfiles.length,
            fatalError: result.report.fatalError,
            reportPath: result.reportPath,
        };
        this.logger.info(
            `Кампанію завершено: успішно ${summary.published}, помилок ${summary.failedComments}`
        );
        return summary;
    }
}
