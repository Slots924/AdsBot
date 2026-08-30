import createFacebookApiClients
    from "../api/createFacebookApiClients.js";
import publishPagePost from "../workflows/publishPagePost.js";
import CreativeManager
    from "../../services/creatives/CreativeManager.js";
import prepareCreativeForCampaign
    from "../../services/creatives/prepareCreativeForCampaign.js";
import loadImageFromPath
    from "../../services/images/loadImageFromPath.js";
import PageRebuildJournal
    from "../../services/workflows/PageRebuildJournal.js";
import rebuildPageFromFolderWorkflow
    from "../workflows/rebuildPageFromFolder.js";


function createBackendError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function safeAccountError(error) {
    return {
        message: String(error?.message || "Невідома помилка Facebook API"),
        code: error?.code ?? null,
        httpStatus: error?.httpStatus ?? null,
        graphCode: error?.graphCode ?? null,
        graphSubcode: error?.graphSubcode ?? null,
    };
}


export default class FacebookBackendService {
    #facebookApiClients;
    #creativeManager;
    #creativeManagerFactory;
    #publishPagePost;
    #prepareCreativeForCampaign;
    #loadImageFromPath;
    #pageRebuildJournal;
    #rebuildPageFromFolder;
    #pageRebuildOperations = new Map();


    constructor({
        facebookApiClients,
        creativeManager = null,
        creativeManagerFactory = () => new CreativeManager(),
        publishPagePostFn = publishPagePost,
        prepareCreativeFn = prepareCreativeForCampaign,
        imageLoader = loadImageFromPath,
        pageRebuildJournal = new PageRebuildJournal(),
        rebuildPageFromFolderFn = rebuildPageFromFolderWorkflow,
    } = {}) {
        if (!(facebookApiClients instanceof Map)) {
            throw createBackendError(
                "Facebook API clients мають бути передані як Map",
                "FACEBOOK_BACKEND_CONFIG_ERROR"
            );
        }

        this.#facebookApiClients = facebookApiClients;
        this.#creativeManager = creativeManager;
        this.#creativeManagerFactory = creativeManagerFactory;
        this.#publishPagePost = publishPagePostFn;
        this.#prepareCreativeForCampaign = prepareCreativeFn;
        this.#loadImageFromPath = imageLoader;
        this.#pageRebuildJournal = pageRebuildJournal;
        this.#rebuildPageFromFolder = rebuildPageFromFolderFn;
    }


    /**
     * Створює facade з Facebook-клієнтами з локальних конфігів.
     * @param {object} options Залежності або параметри фабрики для тестів.
     * @returns {Promise<FacebookBackendService>}
     * @throws {Error} FACEBOOK_BACKEND_CONFIG_ERROR.
     */
    static async create({
        facebookApiClients,
        facebookApiClientsOptions,
        ...dependencies
    } = {}) {
        const clients = facebookApiClients
            ?? await createFacebookApiClients(facebookApiClientsOptions);

        return new FacebookBackendService({
            facebookApiClients: clients,
            ...dependencies,
        });
    }


    #getFacebookApiClient(accountKey) {
        const normalizedAccountKey = String(accountKey ?? "").trim();
        const facebookApiClient = this.#facebookApiClients.get(
            normalizedAccountKey
        );

        if (!facebookApiClient) {
            throw createBackendError(
                `Facebook-акаунт "${normalizedAccountKey}" не знайдено`,
                "FACEBOOK_ACCOUNT_NOT_FOUND"
            );
        }

        return facebookApiClient;
    }


    /**
     * Перевіряє всі акаунти й повертає лише безпечні дані для GUI.
     * @returns {Promise<Array<object>>}
     */
    async getAccounts() {
        return Promise.all(
            [...this.#facebookApiClients.entries()].map(
                async ([accountKey, facebookApiClient]) => {
                    const fallbackName = facebookApiClient.accountName
                        || accountKey;
                    const fallbackId = facebookApiClient.facebookUserId
                        || null;

                    try {
                        const tokenStatus = await facebookApiClient
                            .checkAccessToken();

                        if (!tokenStatus.working) {
                            return {
                                accountKey,
                                facebookUserId: fallbackId,
                                name: fallbackName,
                                status: "inactive",
                                error: tokenStatus.error
                                    ? safeAccountError(tokenStatus.error)
                                    : null,
                            };
                        }

                        return {
                            accountKey,
                            facebookUserId: tokenStatus.user?.id
                                || fallbackId,
                            name: tokenStatus.user?.name || fallbackName,
                            status: "active",
                            error: null,
                        };
                    } catch (error) {
                        return {
                            accountKey,
                            facebookUserId: fallbackId,
                            name: fallbackName,
                            status: "error",
                            error: safeAccountError(error),
                        };
                    }
                }
            )
        );
    }


    /**
     * Повертає доступні для публікації фанпейджі вибраного акаунта.
     * @param {string} accountKey Ключ вибраного Facebook-акаунта.
     * @returns {Promise<Array<{id: string, name: string}>>}
     * @throws {Error} FACEBOOK_ACCOUNT_NOT_FOUND, FACEBOOK_API_ERROR або proxy error.
     */
    async getFanPages(accountKey, options = {}) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.getAvailablePages(options);
    }


    async getFanPageList(accountKey, options = {}) {
        return this.#getFacebookApiClient(accountKey).getPageList(options);
    }


    async getFanPageDetails(accountKey, options = {}) {
        return this.#getFacebookApiClient(accountKey).getPageDetails(options);
    }


    async getPageRebuildRequirements({ accountKey, pageId } = {}) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.getPageRebuildRequirements({ pageId });
    }


    async rebuildPageFromFolder(options = {}, onProgress, signal) {
        const key = `${String(options.accountKey)}:${String(options.pageId)}`;
        const current = this.#pageRebuildOperations.get(key);
        if (current) return current;
        const facebookApiClient = this.#getFacebookApiClient(options.accountKey);
        const operation = this.#rebuildPageFromFolder({
            ...options,
            facebookApiClient,
            journal: this.#pageRebuildJournal,
            imageLoader: this.#loadImageFromPath,
            onProgress,
            signal,
        }).finally(() => {
            if (this.#pageRebuildOperations.get(key) === operation) {
                this.#pageRebuildOperations.delete(key);
            }
        });
        this.#pageRebuildOperations.set(key, operation);
        return operation;
    }


    /**
     * Повертає рекламні акаунти вибраного Facebook-профілю.
     * @param {string} accountKey Ключ вибраного Facebook-акаунта.
     * @returns {Promise<object[]>}
     * @throws {Error} FACEBOOK_ACCOUNT_NOT_FOUND або FACEBOOK_API_ERROR.
     */
    async getAdAccounts(accountKey) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.getAdAccounts();
    }


    /**
     * Повертає кампанії та статистику рекламного акаунта.
     * @param {string} accountKey Ключ Facebook API-клієнта.
     * @param {string} adAccountId Graph ID рекламного акаунта.
     * @param {string} datePreset Meta date preset.
     * @returns {Promise<{campaigns: object[], insights: object[]}>}
     */
    async getAdCampaigns(accountKey, adAccountId, datePreset = "today") {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        const [campaigns, insights] = await Promise.all([
            facebookApiClient.getAdCampaigns(adAccountId),
            facebookApiClient.getAdCampaignInsights(adAccountId, datePreset),
        ]);

        return { campaigns, insights };
    }


    async getAdPixels(accountKey, adAccountId) {
        return this.#getFacebookApiClient(accountKey).getAdPixels(adAccountId);
    }


    async getPagePosts(accountKey, options) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.getPagePosts(options);
    }


    async getLatestPagePostsWithLinks(accountKey, options) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.getLatestPagePostsWithLinks(options);
    }


    async getPagePostsSignature(accountKey, options) {
        return this.#getFacebookApiClient(accountKey)
            .getPagePostsSignature(options);
    }


    async deletePagePosts(accountKey, options) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.deletePagePosts(options);
    }


    async preflightLeadCampaign(accountKey, options) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.preflightLeadCampaign(options);
    }


    async createLeadCampaign(accountKey, options, onProgress) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        if (
            options?.creativeMode !== "image"
            || options?.resume?.creativeId
        ) {
            return facebookApiClient.createLeadCampaign(options, onProgress);
        }

        const prepared = await this.prepareCreative({
            geo: options.geo,
            creativeName: options.creativeName,
            siteUrl: options.siteUrl,
        });
        const lines = String(prepared.creative ?? "")
            .replace(/\r\n/g, "\n")
            .split("\n");
        const headlineIndex = lines.findIndex((line) => line.trim());
        if (headlineIndex === -1) {
            throw createBackendError(
                "Креатив не містить тексту для рекламного оголошення",
                "CAMPAIGN_AD_CREATIVE_EMPTY"
            );
        }
        const image = await this.#loadImageFromPath(options.imagePath);
        return facebookApiClient.createLeadCampaign({
            ...options,
            adCreative: {
                headline: lines[headlineIndex].trim(),
                primaryText: lines.slice(headlineIndex + 1).join("\n").trim(),
                siteUrl: options.siteUrl,
                callToActionType: options.callToActionType,
                image,
            },
        }, onProgress);
    }


    async deleteCampaignDraft(accountKey, objects, onProgress) {
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        return facebookApiClient.deleteCampaignDraft(objects, onProgress);
    }


    /**
     * Отримує креатив і підставляє посилання сайту в його копію.
     * @param {object} options Дані креативу та кампанії.
     * @returns {Promise<{creative: string, comments: object[]}>}
     * @throws {Error} CREATIVE_*, GROK_* або CREATIVE_LINK_*.
     */
    async prepareCreative({ geo, creativeName, siteUrl } = {}) {
        if (!this.#creativeManager) {
            this.#creativeManager = this.#creativeManagerFactory();
        }

        const creative = await this.#creativeManager.getCreative(
            geo,
            creativeName
        );

        return this.#prepareCreativeForCampaign({
            creative,
            siteUrl,
        });
    }


    /**
     * Публікує текст, картинку або картинку з текстом через вибраний акаунт.
     * @param {object} options Дані поста.
     * @returns {Promise<object>} Перевірені дані створеного поста.
     * @throws {Error} FACEBOOK_ACCOUNT_NOT_FOUND, FACEBOOK_POST_* або FACEBOOK_API_ERROR.
     */
    async publishPost({
        accountKey,
        pageId,
        message = "",
        imagePath = "",
        imagePaths = [],
    } = {}, onProgress) {
        const progress = async (payload) => {
            if (typeof onProgress === "function") await onProgress(payload);
        };
        const facebookApiClient = this.#getFacebookApiClient(accountKey);
        const normalizedImagePaths = [...new Set([
            ...(Array.isArray(imagePaths) ? imagePaths : []),
            imagePath,
        ].map((item) => String(item ?? "").trim()).filter(Boolean))];
        const total = 3 + normalizedImagePaths.length;
        if (normalizedImagePaths.length) {
            await progress({ stage: "image", completed: 1, total, message: "Завантажуємо файл зображення" });
        }
        const images = await Promise.all(normalizedImagePaths.map(
            (path) => this.#loadImageFromPath(path)
        ));

        await progress({
            stage: "publication",
            completed: normalizedImagePaths.length ? normalizedImagePaths.length + 1 : 1,
            total,
            message: "Публікуємо пост у Facebook",
        });

        return this.#publishPagePost({
            facebookApiClient,
            pageId,
            message,
            image: images[0],
            images,
        });
    }
}
