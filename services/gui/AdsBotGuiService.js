import AdsPower from "../../classes/AdsPower.js";
import isProfileOpen from "../profile/isProfileOpen.js";
import FacebookBackendService
    from "../../facebook/services/FacebookBackendService.js";
import runCommentingScenario
    from "../../scenarios/runCommentingScenario.js";
import runParallelCommentingScenario
    from "../../scenarios/runParallelCommentingScenario.js";
import runParallelCommentAccountSetupScenario
    from "../../scenarios/runParallelCommentAccountSetupScenario.js";
import syncFacebookApiClientFromAdsPowerProfile
    from "../../facebook/workflows/syncFacebookApiClientFromAdsPowerProfile.js";
import CommentAccountProfileData
    from "../profiles/CommentAccountProfileData.js";
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
        timezoneOffsetHoursUtc: account.timezoneOffsetHoursUtc ?? null,
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
    #runParallelCommentingScenario;
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
        runParallelCommentingScenarioFn = runParallelCommentingScenario,
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
        this.#runParallelCommentingScenario = runParallelCommentingScenarioFn;
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


    async syncFacebookApiClientFromAdsPowerProfile(options = {}) {
        return syncFacebookApiClientFromAdsPowerProfile({
            adsPower: this.adsPower,
            ...options,
        });
    }


    async getAdsPowerProfileOpenState(profileNo) {
        const profile = await this.adsPower.getProfileByNo(profileNo);
        return isProfileOpen(this.adsPower, profile);
    }


    async openAdsPowerProfile(profileNo) {
        await this.adsPower.openProfile(profileNo, {
            browserMode: "visible",
            restoreLastOpenedTabs: true,
        });
        return { isOpen: true };
    }


    async closeAdsPowerProfile(profileNo) {
        await this.adsPower.closeProfile(profileNo);
        return { isOpen: false };
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


    async getFanPages(accountKey, options = {}) {
        await this.#assertActiveAccount(accountKey);
        this.logger.info(`Завантажуємо фанпейджі: ${accountKey}`);
        const fanPages = await this.#facebookBackend.getFanPages(
            accountKey,
            options
        );
        this.logger.info(`Знайдено доступних фанпейджів: ${fanPages.length}`);
        return fanPages;
    }


    async getFanPageList(accountKey, options = {}) {
        await this.#assertActiveAccount(accountKey);
        return this.#facebookBackend.getFanPageList(accountKey, options);
    }


    async getFanPageDetails(options = {}) {
        await this.#assertActiveAccount(options.accountKey);
        return this.#facebookBackend.getFanPageDetails(
            options.accountKey,
            options
        );
    }


    async getPageRebuildRequirements(options = {}) {
        await this.#assertActiveAccount(options.accountKey);
        return this.#facebookBackend.getPageRebuildRequirements(options);
    }


    async rebuildPageFromFolder(options = {}, onProgress, signal) {
        await this.#assertActiveAccount(options.accountKey);
        return this.#facebookBackend.rebuildPageFromFolder(
            options,
            onProgress,
            signal
        );
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


    async getPagePostsWithLinks({ accountKey, pageId, limit = 10 } = {}) {
        await this.#assertActiveAccount(accountKey);
        return this.#facebookBackend.getLatestPagePostsWithLinks(accountKey, { pageId, limit });
    }


    async getPagePostsSignature({ accountKey, pageId, limit = 10 } = {}) {
        await this.#assertActiveAccount(accountKey);
        return this.#facebookBackend.getPagePostsSignature(accountKey, {
            pageId,
            limit,
        });
    }


    async deletePagePosts({ accountKey, pageId, posts } = {}) {
        await this.#assertActiveAccount(accountKey);
        return this.#facebookBackend.deletePagePosts(accountKey, { pageId, posts });
    }


    async getAdPixels({ accountKey, adAccountId } = {}) {
        await this.#assertActiveAccount(accountKey);
        return this.#facebookBackend.getAdPixels(accountKey, adAccountId);
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


    async getAdsPowerGroupProfiles(groupId) {
        const normalizedGroupId = String(groupId ?? "").trim();
        if (!normalizedGroupId) {
            throw createGuiError(
                "Не вказано ID групи AdsPower",
                "GUI_VALIDATION_ERROR"
            );
        }
        if (!this.adsPower) {
            throw createGuiError(
                "AdsPower не підключено",
                "GUI_BACKEND_CONFIG_ERROR"
            );
        }

        const profiles = await this.adsPower.getProfilesByGroupId(
            normalizedGroupId
        );
        return profiles.map((profile) => ({
            profileId: String(profile.profile_id ?? ""),
            profileNo: String(profile.profile_no ?? ""),
            name: String(profile.name ?? profile.username ?? ""),
            groupId: String(profile.group_id ?? normalizedGroupId),
            groupName: String(profile.group_name ?? ""),
            tags: Array.isArray(profile.profile_tags)
                ? profile.profile_tags.map((tag) => (
                    typeof tag === "string"
                        ? { id: "", name: tag }
                        : {
                            id: String(tag.id ?? tag.tag_id ?? ""),
                            name: String(tag.name ?? tag.tag_name ?? ""),
                            color: tag.color ?? null,
                        }
                )).filter((tag) => tag.name)
                : [],
        }));
    }


    async moveAdsPowerProfiles(profileIds, groupId) {
        const normalizedGroupId = String(groupId ?? "").trim();
        const ids = Array.isArray(profileIds)
            ? [...new Set(profileIds.map((id) => String(id ?? "").trim()).filter(Boolean))]
            : [];
        if (!normalizedGroupId) {
            throw createGuiError(
                "Не вказано ID групи AdsPower",
                "GUI_VALIDATION_ERROR"
            );
        }
        if (ids.length === 0) {
            throw createGuiError(
                "Не вибрано профілі для переміщення",
                "GUI_VALIDATION_ERROR"
            );
        }
        if (!this.adsPower) {
            throw createGuiError(
                "AdsPower не підключено",
                "GUI_BACKEND_CONFIG_ERROR"
            );
        }

        for (const profileId of ids) {
            await this.adsPower.updateProfileGroup(profileId, normalizedGroupId);
        }
        return { moved: ids.length, groupId: normalizedGroupId };
    }


    async runCommentAccountSetup({
        profileNos,
        geo,
        maleCount,
        femaleCount,
        photosDirectory,
        concurrency = 5,
        workerProxies = null,
        onProxyUnavailable = null,
        browserMode = "visible",
        signal,
        onProgress,
    } = {}) {
        const numbers = [...new Set(
            (Array.isArray(profileNos) ? profileNos : [])
                .map((value) => String(value ?? "").trim())
                .filter(Boolean)
        )];
        if (numbers.length === 0) {
            throw createGuiError(
                "Не вибрано профілі AdsPower",
                "GUI_VALIDATION_ERROR"
            );
        }

        const provider = new CommentAccountProfileData();
        await onProgress?.({
            stage: "personas",
            message: "Готуємо дані профілів",
        });
        const generated = await provider.getCommentAccountProfiles({
            geo,
            maleCount,
            femaleCount,
        });
        const personas = generated.profiles.map((profile) => ({
            gender: profile.gender,
            firstName: profile.firstName,
            lastName: profile.lastName,
            bio: "",
            education: profile.university,
            work: {
                company: profile.company,
                position: profile.profession,
            },
        }));
        const { report } = await runParallelCommentAccountSetupScenario({
            adsPower: this.adsPower,
            profileNos: numbers,
            personas,
            geo,
            photosDirectory,
            concurrency,
            workerProxies,
            onProxyUnavailable,
            browserMode,
            logger: this.logger,
            signal,
            onProgress,
            reportsDirectory: this.reportsDirectory,
        });
        return {
            reportPath: report.reportPath,
            fatalError: report.fatalError,
            success: report.profiles.filter((item) => item.outcome === "success").length,
            completedWithError: report.profiles.filter((item) =>
                item.outcome === "completed_with_error"
            ).length,
            failed: report.profiles.filter((item) => item.outcome === "failed").length,
            skipped: report.profiles.filter((item) => item.outcome === "skipped").length,
        };
    }


    async publishCreativePost({
        accountKey,
        pageId,
        geo,
        creativeName,
        siteUrl,
        imagePath = "",
        imagePaths = [],
    } = {}, onProgress) {
        const progress = async (payload) => {
            if (typeof onProgress === "function") await onProgress(payload);
        };
        await this.#assertActiveAccount(accountKey);
        const total = imagePath ? 4 : 3;
        await progress({ stage: "creative", completed: 0, total, message: "Готуємо креатив" });
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
            imagePaths,
        }, progress);
        await progress({ stage: "verification", completed: total, total, message: "Пост опубліковано та перевірено" });
        this.logger.info(`Пост підтверджено: ${post.postId}`);
        return post;
    }


    async prepareCreative(options) {
        return this.#facebookBackend.prepareCreative(options);
    }


    async publishPreparedPost({ accountKey, pageId, message, imagePath = "", imagePaths = [] }, onProgress) {
        await this.#assertActiveAccount(accountKey);
        return this.#facebookBackend.publishPost({ accountKey, pageId, message, imagePath, imagePaths }, onProgress);
    }


    async runParallelComments({
        groupIds, comments, geo, creativeName, postUrl,
        browserMode = "visible", disableImages = false,
        concurrency = 5, workerProxies = null, onProxyUnavailable = null,
        signal, onProgress,
    }) {
        return this.#runParallelCommentingScenario({
            adsPower: this.adsPower, groupIds, comments, geo, creativeName, postUrl,
            browserMode, disableImages, concurrency, workerProxies, onProxyUnavailable,
            signal, onProgress,
            logger: this.logger,
        });
    }


    async runParallelCommentingCampaign(options = {}) {
        if (!this.#creativeManager) this.#creativeManager = this.#creativeManagerFactory();
        const creative = await this.#creativeManager.getCreative(options.geo, options.creativeName);
        const comments = prepareCommentsForCampaign({
            creative,
            siteUrl: options.siteUrl ?? "",
            flattenReplies: options.commentTarget === "ad",
        });
        const response = await this.runParallelComments({ ...options, comments });
        const report = response.report;
        return {
            published: report.published.length,
            skipped: report.skipped.length,
            failedComments: report.failedComments.length,
            failedProfiles: report.failedProfiles.length,
            fatalError: report.fatalError,
            browserMode: report.browserMode,
            disableImages: report.disableImages,
            reportDetails: {
                inputSummary: { groupIds: report.groupIds, geo: report.geo, creativeName: report.creativeName, postUrl: report.postUrl, browserMode: report.browserMode, disableImages: report.disableImages },
                resultSummary: { published: report.published, skipped: report.skipped, failedComments: report.failedComments, failedProfiles: report.failedProfiles, uncertain: report.interrupted ? report.failedComments : [] },
                counters: { published: report.published.length, skipped: report.skipped.length, failedComments: report.failedComments.length, failedProfiles: report.failedProfiles.length },
                warnings: report.cleanupWarnings,
            },
        };
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
        browserMode = "visible",
        disableImages = false,
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
            browserMode,
            disableImages,
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
            browserMode: result.report.browserMode,
            disableImages: result.report.disableImages,
            reportDetails: {
                inputSummary: {
                    groupIds: result.report.groupIds,
                    geo: result.report.geo,
                    creativeName: result.report.creativeName,
                    postUrl: result.report.postUrl,
                    browserMode: result.report.browserMode,
                    disableImages: result.report.disableImages,
                },
                resultSummary: {
                    published: result.report.published,
                    skipped: result.report.skipped,
                    failedComments: result.report.failedComments,
                    failedProfiles: result.report.failedProfiles,
                    excludedProfiles: result.report.excludedProfiles,
                    cleanupWarnings: result.report.cleanupWarnings,
                    fatalError: result.report.fatalError,
                },
                counters: {
                    published: result.report.published.length,
                    skipped: result.report.skipped.length,
                    failedComments: result.report.failedComments.length,
                    failedProfiles: result.report.failedProfiles.length,
                },
                warnings: result.report.cleanupWarnings,
                errors: result.report.fatalError ? [{ message: result.report.fatalError }] : [],
            },
        };
        this.logger.info(
            `Кампанію завершено: успішно ${summary.published}, помилок ${summary.failedComments}`
        );
        return summary;
    }
}
