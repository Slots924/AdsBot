import { getLogger } from "../../services/logging/runtimeLogger.js";
import collectLatestPagePostsWithLinks
    from "../workflows/collectLatestPagePostsWithLinks.js";
import deletePagePostsWorkflow
    from "../workflows/deletePagePosts.js";


function redactSensitiveText(value) {
    return String(value ?? "")
        .replace(/EAA[A-Za-z0-9]+/g, "[REDACTED]")
        .replace(/((?:access_)?token|cookie)=([^&\s]+)/gi, "$1=[REDACTED]");
}


function createFacebookApiError(error, {
    outcomeUnknownCode = "FACEBOOK_POST_OUTCOME_UNKNOWN",
    outcomeUnknownMessage = "Не вдалося визначити, чи Facebook опублікував пост",
} = {}) {
    if (error?.code === "PROXY_POOL_EXHAUSTED") {
        return error;
    }

    if (error?.code === "PROXY_REQUEST_OUTCOME_UNKNOWN") {
        const outcomeError = new Error(outcomeUnknownMessage);
        outcomeError.code = outcomeUnknownCode;
        return outcomeError;
    }

    const graphError = error?.response?.data?.error;
    const graphUserTitle = redactSensitiveText(
        graphError?.error_user_title ?? ""
    );
    const graphUserMessage = redactSensitiveText(
        graphError?.error_user_msg ?? ""
    );
    const facebookError = new Error(redactSensitiveText(
        graphUserMessage
        || graphError?.message
        || "Не вдалося виконати запит Facebook API"
    ));

    const message = facebookError.message.toLowerCase();
    facebookError.code = message.includes("beneficiar")
        ? "CAMPAIGN_DSA_BENEFICIARY_REJECTED"
        : /(payor|payer)/.test(message)
            ? "CAMPAIGN_DSA_PAYOR_REJECTED"
            : /\bdsa\b/.test(message)
                ? "CAMPAIGN_DSA_REJECTED"
                : "FACEBOOK_API_ERROR";
    facebookError.httpStatus = error?.response?.status ?? null;
    facebookError.graphCode = graphError?.code ?? null;
    facebookError.graphSubcode = graphError?.error_subcode ?? null;
    facebookError.graphType = graphError?.type ?? null;
    facebookError.graphUserTitle = graphUserTitle || null;
    facebookError.graphUserMessage = graphUserMessage || null;

    return facebookError;
}


const pagePublishTasks = new Set([
    "CREATE_CONTENT",
    "MANAGE",
    "PROFILE_PLUS_CREATE_CONTENT",
    "PROFILE_PLUS_MANAGE",
    "PROFILE_PLUS_FULL_CONTROL",
]);
const pageAdvertiseTasks = new Set([
    "ADVERTISE",
    "MANAGE",
    "PROFILE_PLUS_ADVERTISE",
    "PROFILE_PLUS_MANAGE",
    "PROFILE_PLUS_FULL_CONTROL",
]);

const campaignDatePresets = new Set([
    "today",
    "yesterday",
    "last_7d",
    "last_30d",
    "maximum",
]);

const europeanDsaCountries = new Set([
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
    "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
    "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]);

const zeroDecimalCurrencies = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA",
    "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

const disabledCreativeFeatures = [
    "standard_enhancements",
    "advantage_plus_creative",
    "audio",
    "music_generation",
    "image_animation",
    "image_auto_crop",
    "image_background_gen",
    "image_brightness_and_contrast",
    "image_enhancement",
    "image_text_translation",
    "image_touchups",
    "image_uncrop",
    "text_generation",
    "text_optimizations",
    "text_translation",
    "video_auto_crop",
    "video_filtering",
    "video_highlights",
    "video_uncrop",
];
const campaignPostFields = [
    "id",
    "message",
    "created_time",
    "permalink_url",
    "is_published",
    "status_type",
    "full_picture",
    "attachments{media_type,url,unshimmed_url,target,media{image{src}},subattachments{url,unshimmed_url,target}}",
].join(",");


function hasPagePublishTask(tasks) {
    return Array.isArray(tasks)
        && tasks.some((task) =>
            pagePublishTasks.has(String(task ?? "").trim().toUpperCase())
        );
}


function normalizeAdAccountId(value) {
    const id = String(value ?? "").trim();
    if (!/^act_\d+$/.test(id)) {
        const error = new Error("Некоректний Graph ID рекламного акаунта");
        error.code = "FACEBOOK_AD_ACCOUNT_ID_INVALID";
        throw error;
    }
    return id;
}


async function mapWithConcurrency(items, worker, concurrency = 3) {
    const result = new Array(items.length);
    let nextIndex = 0;
    const run = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            result[index] = await worker(items[index], index);
        }
    };
    await Promise.all(Array.from(
        { length: Math.min(concurrency, items.length) },
        run
    ));
    return result;
}


function createValidationError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


function toFormData(fields, validateOnly = false) {
    const body = new URLSearchParams();
    Object.entries(fields).forEach(([key, value]) => {
        if (value === undefined || value === null || value === "") return;
        body.set(
            key,
            typeof value === "object" ? JSON.stringify(value) : String(value)
        );
    });
    if (validateOnly) {
        body.set("execution_options", JSON.stringify(["validate_only"]));
    }
    return body;
}


function normalizeObjectId(value, code, label) {
    const id = String(value ?? "").trim();
    if (!/^\d+$/.test(id)) {
        throw createValidationError(`Некоректний ${label}`, code);
    }
    return id;
}


function isFacebookHost(hostname) {
    const host = String(hostname ?? "").toLowerCase();
    return host === "facebook.com" || host.endsWith(".facebook.com");
}


function isExternalWebsiteUrl(value) {
    try {
        let parsed = new URL(String(value ?? "").replace(/[),.;!?]+$/, ""));
        if (isFacebookHost(parsed.hostname) && parsed.pathname === "/l.php") {
            const target = parsed.searchParams.get("u");
            if (!target) return false;
            parsed = new URL(target);
        }
        const host = parsed.hostname.toLowerCase();
        return !isFacebookHost(host)
            && host !== "fb.com"
            && !host.endsWith(".fb.com");
    } catch {
        return false;
    }
}


function attachmentUrls(attachments = []) {
    return (Array.isArray(attachments) ? attachments : []).flatMap(
        (attachment) => [
            attachment?.unshimmed_url,
            attachment?.url,
            attachment?.target?.url,
            ...attachmentUrls(attachment?.subattachments?.data),
        ]
    ).filter(Boolean);
}


function hasExternalWebsiteUrl(post) {
    const messageUrls = String(post?.message ?? "")
        .match(/https?:\/\/[^\s]+/gi) ?? [];
    return [
        ...messageUrls,
        ...attachmentUrls(post?.attachments?.data),
    ].some(isExternalWebsiteUrl);
}


function safeThumbnailUrl(value) {
    try {
        const parsed = new URL(String(value ?? ""));
        if (
            parsed.protocol !== "https:"
            || !(
                parsed.hostname === "fbcdn.net"
                || parsed.hostname.endsWith(".fbcdn.net")
            )
        ) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}


function normalizePagePost(post) {
    const message = String(post?.message ?? "");
    const attachment = post?.attachments?.data?.[0];
    return {
        id: String(post?.id ?? ""),
        message: message.length > 500 ? `${message.slice(0, 497)}…` : message,
        createdTime: post?.created_time ?? null,
        permalinkUrl: post?.permalink_url ?? null,
        thumbnailUrl: safeThumbnailUrl(
            attachment?.media?.image?.src ?? post?.full_picture
        ),
        type: post?.status_type ?? attachment?.media_type ?? null,
    };
}


function budgetToMinorUnits(value, currency) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw createValidationError(
            "Бюджет одного ad set має бути більшим за нуль",
            "CAMPAIGN_BUDGET_INVALID"
        );
    }
    const multiplier = zeroDecimalCurrencies.has(
        String(currency ?? "").toUpperCase()
    ) ? 1 : 100;
    return String(Math.round(amount * multiplier));
}


function buildTargeting(template) {
    const facebookPositions = (template.placements?.facebook ?? []).map(
        (position) => position === "reels" ? "facebook_reels" : position
    );
    const instagramPositions = template.placements?.instagram ?? [];
    const publisherPlatforms = [
        ...(facebookPositions.length ? ["facebook"] : []),
        ...(instagramPositions.length ? ["instagram"] : []),
    ];
    const gender = template.gender === "male"
        ? [1]
        : template.gender === "female" ? [2] : undefined;

    return {
        age_min: template.ageMin,
        age_max: template.ageMax,
        geo_locations: { countries: template.countryCodes },
        ...(template.locales?.length ? { locales: template.locales } : {}),
        publisher_platforms: publisherPlatforms,
        ...(facebookPositions.length
            ? { facebook_positions: facebookPositions }
            : {}),
        ...(instagramPositions.length
            ? { instagram_positions: instagramPositions }
            : {}),
        ...(gender ? { genders: gender } : {}),
        ...(template.devicePlatforms?.length
            ? { device_platforms: template.devicePlatforms }
            : {}),
        ...(template.operatingSystems?.length
            ? { user_os: template.operatingSystems }
            : {}),
        targeting_automation: { advantage_audience: 0 },
    };
}


function buildEnhancementsOptOut() {
    return {
        creative_features_spec: Object.fromEntries(
            disabledCreativeFeatures.map((feature) => [
                feature,
                { enroll_status: "OPT_OUT" },
            ])
        ),
    };
}


function resolveDsaSettings(template, account) {
    const countries = Array.isArray(template.countryCodes)
        ? template.countryCodes.map((code) => String(code).toUpperCase())
        : [];
    const requiredForEurope = countries.some((code) => (
        europeanDsaCountries.has(code)
    ));
    const templateBeneficiary = String(
        template.dsaBeneficiary ?? ""
    ).trim();
    const templatePayor = template.dsaPayorSameAsBeneficiary !== false
        ? templateBeneficiary
        : String(template.dsaPayor ?? "").trim();
    const defaultBeneficiary = String(
        account.default_dsa_beneficiary ?? ""
    ).trim();
    const defaultPayor = String(account.default_dsa_payor ?? "").trim();
    const shouldResolve = requiredForEurope
        || Boolean(templateBeneficiary)
        || Boolean(templatePayor);

    if (!shouldResolve) return null;

    const beneficiary = templateBeneficiary || defaultBeneficiary;
    const payor = templatePayor || defaultPayor;
    if (!beneficiary) {
        throw createValidationError(
            "Для європейської аудиторії вкажіть бенефіціара у шаблоні або налаштуйте default DSA beneficiary у Meta",
            "CAMPAIGN_DSA_BENEFICIARY_REQUIRED"
        );
    }
    if (!payor) {
        throw createValidationError(
            "Для європейської аудиторії вкажіть платника у шаблоні або налаштуйте default DSA payor у Meta",
            "CAMPAIGN_DSA_PAYOR_REQUIRED"
        );
    }

    return {
        beneficiary,
        payor,
        beneficiarySource: templateBeneficiary ? "template" : "meta-default",
        payorSource: templatePayor ? "template" : "meta-default",
        requiredForEurope,
    };
}


export default class FacebookGraphApi {
    #pagesCache = null;
    #pagesRequest = null;
    #accessToken;
    #cookie;
    #proxyHttpClient;


    constructor({
        accountKey,
        accountName = "",
        facebookUserId = "",
        accessToken,
        cookie,
        userAgent,
        proxyHttpClient,
    }) {
        if (!proxyHttpClient?.request) {
            throw new Error("Не передано ProxyHttpClient");
        }

        this.accountKey = accountKey;
        this.accountName = String(accountName ?? "").trim();
        this.facebookUserId = String(facebookUserId ?? "").trim();
        this.userAgent = userAgent;
        this.apiUrl = "https://graph.facebook.com/v26.0";
        this.#accessToken = accessToken;
        this.#cookie = cookie;
        this.#proxyHttpClient = proxyHttpClient;
    }


    async #request(pathname, params = {}, {
        method = "get",
        data,
        accessToken = this.#accessToken,
        headers = {},
        retryOnConnectionError = true,
        outcomeUnknownCode,
        outcomeUnknownMessage,
    } = {}) {
        const normalizedPathname = String(pathname).startsWith("/")
            ? pathname
            : `/${pathname}`;
        const startedAt = Date.now();
        const logger = getLogger("facebook.graph", {
            accountKey: this.accountKey,
        });
        logger.debug("graph.request", "Надсилаємо Graph API-запит", {
            method,
            endpoint: normalizedPathname,
        });

        try {
            const response = await this.#proxyHttpClient.request({
                method,
                url: `${this.apiUrl}${normalizedPathname}`,
                params,
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${accessToken}`,
                    Cookie: this.#cookie,
                    "User-Agent": this.userAgent,
                    ...headers,
                },
                ...(data === undefined ? {} : { data }),
                timeout: 30000,
            }, {
                retryOnConnectionError,
            });

            logger.debug("graph.response", "Graph API відповів", {
                method,
                endpoint: normalizedPathname,
                status: response.status,
                durationMs: Date.now() - startedAt,
            });
            return response.data;
        } catch (error) {
            const normalizedError = createFacebookApiError(error, {
                outcomeUnknownCode,
                outcomeUnknownMessage,
            });
            logger.error("graph.request.failed", "Graph API-запит завершився помилкою", {
                method,
                endpoint: normalizedPathname,
                durationMs: Date.now() - startedAt,
                graphCode: normalizedError.graphCode,
                graphSubcode: normalizedError.graphSubcode,
                error: normalizedError,
            });
            throw normalizedError;
        }
    }


    async #getAll(pathname, params = {}) {
        const items = [];
        let after = null;

        do {
            const data = await this.#request(pathname, {
                ...params,
                ...(after ? { after } : {}),
            });

            if (Array.isArray(data?.data)) {
                items.push(...data.data);
            }

            after = data?.paging?.next
                ? data?.paging?.cursors?.after ?? null
                : null;
        } while (after);

        return items;
    }


    async #getAllWithAccessToken(pathname, params, accessToken) {
        const items = [];
        let after = null;

        do {
            const data = await this.#request(pathname, {
                ...params,
                ...(after ? { after } : {}),
            }, { accessToken });
            if (Array.isArray(data?.data)) items.push(...data.data);
            after = data?.paging?.next
                ? data?.paging?.cursors?.after ?? null
                : null;
        } while (after);

        return items;
    }


    /**
     * Перевіряє, чи працює access token, через запит /me.
     * @returns {Promise<{working: boolean, user?: object, error?: object}>}
     * @throws {Error} FACEBOOK_API_ERROR для помилок, не пов'язаних із невалідним token.
     */
    async checkAccessToken() {
        try {
            const user = await this.getMe();

            return {
                working: true,
                user,
            };
        } catch (error) {
            if (
                error.code === "FACEBOOK_API_ERROR"
                && error.graphCode === 190
            ) {
                return {
                    working: false,
                    error: {
                        message: error.message,
                        code: error.graphCode,
                        subcode: error.graphSubcode,
                        type: error.graphType,
                    },
                };
            }

            throw error;
        }
    }


    /**
     * Повертає ID та ім'я власника user access token.
     * @returns {Promise<{id: string, name: string}>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getMe() {
        const data = await this.#request("/me", {
            fields: "id,name",
        });

        return {
            id: data.id,
            name: data.name,
        };
    }


    /**
     * Повертає permissions, згруповані за їхнім статусом.
     * @returns {Promise<{granted: string[], declined: string[], expired: string[], other: object[]}>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getPermissions() {
        const permissions = await this.#getAll("/me/permissions");
        const result = {
            granted: [],
            declined: [],
            expired: [],
            other: [],
        };

        permissions.forEach((item) => {
            if (Array.isArray(result[item.status])) {
                result[item.status].push(item.permission);
                return;
            }

            result.other.push(item);
        });

        return result;
    }


    /**
     * Повертає всі доступні рекламні акаунти.
     * @returns {Promise<object[]>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getAdAccounts() {
        const accounts = await this.#getAll("/me/adaccounts", {
            fields: [
                "id",
                "account_id",
                "name",
                "account_status",
                "disable_reason",
                "currency",
                "timezone_name",
                "timezone_offset_hours_utc",
                "created_time",
                "amount_spent",
                "balance",
                "spend_cap",
                "default_dsa_beneficiary",
                "default_dsa_payor",
                "owner",
                "business{id,name}",
            ].join(","),
        });

        return accounts.map((account) => ({
            id: account.id,
            accountId: account.account_id,
            name: account.name,
            accountStatus: account.account_status,
            disableReason: account.disable_reason ?? null,
            currency: account.currency,
            timezoneName: account.timezone_name,
            timezoneOffsetHoursUtc: account.timezone_offset_hours_utc ?? null,
            createdTime: account.created_time ?? null,
            amountSpent: account.amount_spent ?? null,
            balance: account.balance ?? null,
            spendCap: account.spend_cap ?? null,
            defaultDsaBeneficiary: account.default_dsa_beneficiary ?? null,
            defaultDsaPayor: account.default_dsa_payor ?? null,
            owner: account.owner ?? null,
            business: account.business ?? null,
        }));
    }


    /**
     * Повертає активні та призупинені кампанії рекламного акаунта.
     * @param {string} adAccountId Graph ID у форматі act_123.
     * @returns {Promise<object[]>}
     */
    async getAdCampaigns(adAccountId) {
        const id = normalizeAdAccountId(adAccountId);
        const campaigns = await this.#getAll(`/${id}/campaigns`, {
            fields: "id,name,status,effective_status",
            filtering: JSON.stringify([{
                field: "effective_status",
                operator: "IN",
                value: ["ACTIVE", "PAUSED"],
            }]),
            limit: 100,
        });

        return campaigns.map((campaign) => ({
            id: campaign.id,
            name: campaign.name ?? "Без назви",
            status: campaign.status ?? null,
            effectiveStatus: campaign.effective_status ?? null,
        }));
    }


    /**
     * Повертає campaign-level статистику рекламного акаунта.
     * @param {string} adAccountId Graph ID у форматі act_123.
     * @param {string} datePreset Підтримуваний Meta date preset.
     * @returns {Promise<object[]>}
     */
    async getAdCampaignInsights(adAccountId, datePreset = "today") {
        const id = normalizeAdAccountId(adAccountId);
        const normalizedPreset = String(datePreset ?? "").trim();

        if (!campaignDatePresets.has(normalizedPreset)) {
            const error = new Error("Непідтримуваний період статистики");
            error.code = "FACEBOOK_INSIGHTS_DATE_PRESET_INVALID";
            throw error;
        }

        const insights = await this.#getAll(`/${id}/insights`, {
            fields: "campaign_id,campaign_name,spend,actions",
            level: "campaign",
            date_preset: normalizedPreset,
            limit: 100,
        });

        return insights.map((insight) => ({
            campaignId: insight.campaign_id,
            campaignName: insight.campaign_name ?? null,
            spend: insight.spend ?? "0",
            actions: Array.isArray(insight.actions) ? insight.actions : [],
        }));
    }


    /**
     * Повертає денний спенд усіх кампаній рекламного акаунта за точний період.
     * Поточний день у відповіді містить накопичені дані на момент запиту.
     * @param {string} adAccountId Graph ID у форматі act_123.
     * @param {{since: string, until: string}} range Дати YYYY-MM-DD включно.
     * @returns {Promise<object[]>}
     */
    async getAdCampaignSpend(adAccountId, { since, until } = {}) {
        const id = normalizeAdAccountId(adAccountId);
        const from = String(since ?? "").trim();
        const to = String(until ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
            const error = new Error("Для спенду потрібні дати since та until у форматі YYYY-MM-DD");
            error.code = "FACEBOOK_INSIGHTS_DATE_RANGE_INVALID";
            throw error;
        }
        const insights = await this.#getAll(`/${id}/insights`, {
            fields: "campaign_id,campaign_name,spend,date_start,date_stop",
            level: "campaign",
            time_range: JSON.stringify({ since: from, until: to }),
            time_increment: 1,
            limit: 500,
        });
        return insights.map((insight) => ({
            campaignId: String(insight.campaign_id ?? ""),
            campaignName: insight.campaign_name ?? null,
            spend: insight.spend ?? "0",
            dateStart: insight.date_start ?? from,
            dateStop: insight.date_stop ?? insight.date_start ?? to,
        })).filter((insight) => insight.campaignId);
    }


    /**
     * Повертає всі доступні fan pages разом із Page access tokens.
     * @returns {Promise<object[]>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getPages({ force = false } = {}) {
        if (!force && this.#pagesCache) return this.#pagesCache;
        if (!force && this.#pagesRequest) return this.#pagesRequest;

        const request = this.#getAll("/me/accounts", {
            fields: "id,name,category,tasks,access_token,picture.type(square){url}",
        }).then((pages) => pages.map((page) => ({
            id: page.id,
            name: page.name,
            category: page.category,
            tasks: page.tasks ?? [],
            pageAccessToken: page.access_token,
            pictureUrl: page.picture?.data?.url ?? null,
        }))).then((pages) => {
            this.#pagesCache = pages;
            return pages;
        }).finally(() => {
            if (this.#pagesRequest === request) this.#pagesRequest = null;
        });
        this.#pagesRequest = request;
        return request;
    }


    async #getPublishablePage(page) {
        if (
            !page?.pageAccessToken
            || !hasPagePublishTask(page.tasks)
        ) {
            return null;
        }

        try {
            const data = await this.#request(`/${page.id}`, {
                fields: "id,name,is_published",
            }, {
                accessToken: page.pageAccessToken,
            });

            if (data?.is_published === false) {
                return null;
            }

            return {
                ...page,
                id: data?.id ?? page.id,
                name: data?.name ?? page.name,
            };
        } catch (error) {
            if (
                error?.code === "FACEBOOK_API_ERROR"
                && [400, 403].includes(error.httpStatus)
            ) {
                return null;
            }

            throw error;
        }
    }


    async #cacheImageUrl(url, maximumBytes = 2_000_000) {
        if (!/^https:\/\//i.test(String(url ?? ""))) return url;
        try {
            const response = await this.#proxyHttpClient.get(url, {
                responseType: "arraybuffer",
                headers: {
                    "User-Agent": this.userAgent,
                    Accept: "image/jpeg,image/png,image/webp",
                },
            });
            let contentType = String(
                response.headers?.["content-type"] ?? ""
            ).split(";")[0].trim().toLowerCase();
            const image = Buffer.from(response.data);
            if (contentType === "image/jpg") contentType = "image/jpeg";
            if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)) {
                if (image.subarray(0, 2).toString("hex") === "ffd8") {
                    contentType = "image/jpeg";
                } else if (image.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
                    contentType = "image/png";
                } else if (
                    image.subarray(0, 4).toString("ascii") === "RIFF"
                    && image.subarray(8, 12).toString("ascii") === "WEBP"
                ) {
                    contentType = "image/webp";
                }
            }
            if (
                !new Set(["image/jpeg", "image/png", "image/webp"]).has(contentType)
                || image.length > maximumBytes
            ) {
                return url;
            }
            return `data:${contentType};base64,${image.toString("base64")}`;
        } catch {
            return url;
        }
    }


    async #cachePagePicture(page) {
        return {
            ...page,
            pictureUrl: await this.#cacheImageUrl(page?.pictureUrl),
        };
    }


    #cachePostPictures(posts) {
        return mapWithConcurrency(posts, async (post) => ({
            ...post,
            thumbnailUrl: await this.#cacheImageUrl(
                post?.thumbnailUrl,
                1_500_000
            ),
        }), 3);
    }


    /**
     * Повертає безпечний список фанпейджів без Page access tokens.
     * @returns {Promise<Array<{id: string, name: string}>>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getAvailablePages({ force = false } = {}) {
        const pages = await this.getPages({ force });
        const checkedPages = await mapWithConcurrency(
            pages,
            (page) => this.#getPublishablePage(page),
            3
        );

        const availablePages = checkedPages
            .filter(Boolean)
            .map((page) => ({
                id: page.id,
                name: page.name,
                pictureUrl: page.pictureUrl ?? null,
            }));
        return mapWithConcurrency(
            availablePages,
            (page) => this.#cachePagePicture(page),
            3
        );
    }


    async getPageList({ force = false } = {}) {
        let pages;
        if (force) {
            const previousPictures = new Map((this.#pagesCache ?? []).map(
                (page) => [String(page.id), page.pictureUrl ?? null]
            ));
            const data = await this.#getAll("/me/accounts", {
                fields: "id,name,tasks,access_token",
            });
            pages = data.map((page) => ({
                id: page.id,
                name: page.name,
                category: null,
                tasks: page.tasks ?? [],
                pageAccessToken: page.access_token,
                pictureUrl: previousPictures.get(String(page.id)) ?? null,
            }));
            this.#pagesCache = pages;
        } else {
            pages = await this.getPages();
        }
        return pages
            .filter((page) => page?.pageAccessToken && hasPagePublishTask(page.tasks))
            .map((page) => ({
                id: page.id,
                name: page.name,
                pictureUrl: page.pictureUrl ?? null,
            }));
    }


    async getPageDetails({ pageId } = {}) {
        const page = await this.getFanPageById(pageId);
        if (!page) {
            throw createValidationError(
                "Немає доступу до вибраної фанпейджі",
                "PAGE_DETAILS_ACCESS_DENIED"
            );
        }
        const data = await this.#request(`/${page.id}`, {
            fields: "id,name,is_published,picture.type(square){url}",
        }, { accessToken: page.pageAccessToken });
        if (data?.is_published === false) {
            throw createValidationError(
                "Вибрана фанпейджа не опублікована",
                "PAGE_DETAILS_UNPUBLISHED"
            );
        }
        return this.#cachePagePicture({
            id: data?.id ?? page.id,
            name: data?.name ?? page.name,
            pictureUrl: data?.picture?.data?.url ?? page.pictureUrl ?? null,
        });
    }


    /**
     * Знаходить доступну фанпейджу разом із її Page access token.
     * @param {string} pageId ID фанпейджі.
     * @returns {Promise<object|null>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getFanPageById(pageId) {
        const normalizedPageId = String(pageId ?? "").trim();

        if (!normalizedPageId) {
            return null;
        }

        const pages = await this.getPages();

        const page = pages.find(
            (page) => String(page.id) === normalizedPageId
        ) ?? null;

        if (!page) {
            return null;
        }

        return this.#getPublishablePage(page);
    }


    async #getRebuildPage(pageId) {
        const normalizedPageId = String(pageId ?? "").trim();
        if (!normalizedPageId) {
            throw createValidationError(
                "Не вказано ID фанпейджа",
                "PAGE_REBUILD_PAGE_ID_REQUIRED"
            );
        }
        const page = await this.getFanPageById(normalizedPageId);
        if (!page) {
            throw createValidationError(
                "Немає доступу на керування вибраною фанпейджою",
                "PAGE_REBUILD_PAGE_ACCESS_DENIED"
            );
        }
        return page;
    }


    /** Перевіряє доступність Page та читає її дату створення без мутацій. */
    async getPageRebuildRequirements({ pageId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        let data;
        try {
            data = await this.#request(`/${page.id}`, {
                fields: "id,name,is_published,created_time",
            }, { accessToken: page.pageAccessToken });
        } catch (error) {
            const createdTimeUnavailable = Number(error?.graphCode) === 100
                || String(error?.message ?? "").includes("created_time");
            if (!createdTimeUnavailable) throw error;
            data = {
                id: page.id,
                name: page.name,
                is_published: true,
            };
        }
        const pageCreatedAt = data?.created_time ?? null;
        return {
            pageId: String(data?.id ?? page.id),
            pageName: String(data?.name ?? page.name ?? ""),
            pageCreatedAt,
            requiresPageCreatedAt: !pageCreatedAt,
        };
    }


    /** Повертає повний snapshot старих постів і завантажених фотографій. */
    async getPageRebuildSnapshot({ pageId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const [posts, photos] = await Promise.all([
            this.#getAllWithAccessToken(`/${page.id}/feed`, {
                fields: "id,created_time,is_hidden,message,status_type,story",
                limit: 100,
            }, page.pageAccessToken),
            this.#getAllWithAccessToken(`/${page.id}/photos`, {
                fields: "id,created_time,name,album{id,name}",
                type: "uploaded",
                limit: 100,
            }, page.pageAccessToken),
        ]);
        return {
            posts: posts.filter((post) => post?.id).map((post) => ({
                id: String(post.id),
                createdTime: post.created_time ?? null,
                isHidden: post.is_hidden === true,
                message: post.message ?? "",
                objectId: null,
                statusType: post.status_type ?? null,
                story: post.story ?? "",
            })),
            photos: photos.filter((photo) => photo?.id).map((photo) => ({
                id: String(photo.id),
                createdTime: photo.created_time ?? null,
                name: photo.name ?? "",
                albumId: photo.album?.id ? String(photo.album.id) : null,
                albumName: photo.album?.name ?? null,
            })),
        };
    }


    async #resolveNewUploadedPhoto(page, knownPhotoIds) {
        const known = new Set((knownPhotoIds ?? []).map(String));
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const photos = await this.#getAllWithAccessToken(`/${page.id}/photos`, {
                fields: "id,created_time",
                type: "uploaded",
                limit: 100,
            }, page.pageAccessToken);
            const created = photos
                .filter((photo) => photo?.id && !known.has(String(photo.id)))
                .sort((left, right) => (
                    new Date(right.created_time ?? 0) - new Date(left.created_time ?? 0)
                ));
            if (created[0]?.id) return String(created[0].id);
            if (attempt < 4) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        return null;
    }


    /** Завантажує й установлює нову фотографію профілю Page. */
    async setPageProfilePicture({ pageId, image, knownPhotoIds = [] } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const body = new FormData();
        body.set("source", new Blob([image.buffer], {
            type: image.contentType,
        }), image.filename);
        let data;
        try {
            data = await this.#request(`/${page.id}/picture`, {}, {
                method: "post",
                data: body,
                accessToken: page.pageAccessToken,
                retryOnConnectionError: false,
                outcomeUnknownCode: "FACEBOOK_PAGE_AVATAR_OUTCOME_UNKNOWN",
                outcomeUnknownMessage: "Не вдалося визначити, чи Meta змінила avatar",
            });
        } catch (error) {
            if (error?.code !== "FACEBOOK_PAGE_AVATAR_OUTCOME_UNKNOWN") throw error;
            const recoveredId = await this.#resolveNewUploadedPhoto(page, knownPhotoIds);
            if (!recoveredId) throw error;
            return { photoId: recoveredId, recovered: true };
        }
        const photoId = data?.id
            ? String(data.id)
            : await this.#resolveNewUploadedPhoto(page, knownPhotoIds);
        if (!photoId) {
            throw createValidationError(
                "Meta змінила avatar, але не повернула ID фотографії",
                "PAGE_REBUILD_AVATAR_ID_MISSING"
            );
        }
        return { photoId, recovered: false };
    }


    /** Завантажує фото без публікації у стрічці. */
    async createUnpublishedPagePhoto({
        pageId,
        image,
        knownPhotoIds = [],
    } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const body = new FormData();
        body.set("source", new Blob([image.buffer], {
            type: image.contentType,
        }), image.filename);
        body.set("published", "false");
        let data;
        try {
            data = await this.#request(`/${page.id}/photos`, {}, {
                method: "post",
                data: body,
                accessToken: page.pageAccessToken,
                retryOnConnectionError: false,
                outcomeUnknownCode: "FACEBOOK_PAGE_PHOTO_UPLOAD_OUTCOME_UNKNOWN",
                outcomeUnknownMessage: "Не вдалося визначити, чи Meta завантажила фотографію",
            });
        } catch (error) {
            if (error?.code !== "FACEBOOK_PAGE_PHOTO_UPLOAD_OUTCOME_UNKNOWN") throw error;
            const recoveredId = await this.#resolveNewUploadedPhoto(page, knownPhotoIds);
            if (!recoveredId) throw error;
            return { photoId: recoveredId, recovered: true };
        }
        const photoId = data?.id ? String(data.id) : null;
        if (!photoId) {
            throw createValidationError(
                "Meta не повернула ID завантаженої фотографії",
                "PAGE_REBUILD_PHOTO_ID_MISSING"
            );
        }
        return { photoId, recovered: false };
    }


    /** Завантажує й установлює нову обкладинку Page. */
    async setPageCoverPicture({
        pageId,
        image,
        photoId,
        knownPhotoIds = [],
    } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const uploaded = photoId
            ? { photoId: String(photoId), recovered: true }
            : await this.createUnpublishedPagePhoto({
                pageId: page.id,
                image,
                knownPhotoIds,
            });
        const body = new URLSearchParams();
        body.set("cover", uploaded.photoId);
        let data;
        try {
            data = await this.#request(`/${page.id}`, {}, {
                method: "post",
                data: body,
                accessToken: page.pageAccessToken,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                retryOnConnectionError: false,
                outcomeUnknownCode: "FACEBOOK_PAGE_COVER_OUTCOME_UNKNOWN",
                outcomeUnknownMessage: "Не вдалося визначити, чи Meta змінила обкладинку",
            });
        } catch (error) {
            error.photoId = uploaded.photoId;
            if (error?.code !== "FACEBOOK_PAGE_COVER_OUTCOME_UNKNOWN") throw error;
            const current = await this.#request(`/${page.id}`, {
                fields: "cover{id}",
            }, { accessToken: page.pageAccessToken });
            if (String(current?.cover?.id ?? "") !== uploaded.photoId) throw error;
            return { ...uploaded, recovered: true };
        }
        if (data !== true && data?.success !== true) {
            throw createValidationError(
                "Meta не підтвердила зміну обкладинки",
                "PAGE_REBUILD_COVER_NOT_CONFIRMED"
            );
        }
        return uploaded;
    }


    /** Приховує службовий пост Page. */
    async hidePagePost({ pageId, postId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const body = new URLSearchParams();
        body.set("is_hidden", "true");
        const data = await this.#request(`/${postId}`, {}, {
            method: "post",
            data: body,
            accessToken: page.pageAccessToken,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
        });
        if (data !== true && data?.success !== true) {
            throw createValidationError(
                "Meta не підтвердила приховування службового поста",
                "PAGE_REBUILD_HIDE_NOT_CONFIRMED"
            );
        }
        return true;
    }


    async #pageObjectExists(objectId, pageAccessToken) {
        try {
            await this.#request(`/${objectId}`, { fields: "id" }, {
                accessToken: pageAccessToken,
            });
            return true;
        } catch (error) {
            if (error?.httpStatus === 404 || [100, 803].includes(Number(error?.graphCode))) {
                return false;
            }
            throw error;
        }
    }


    /** Видаляє старий post/photo і перевіряє невизначений результат. */
    async deletePageObject({ pageId, objectId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        try {
            const data = await this.#request(`/${objectId}`, {}, {
                method: "delete",
                accessToken: page.pageAccessToken,
                retryOnConnectionError: false,
                outcomeUnknownCode: "FACEBOOK_PAGE_OBJECT_DELETE_OUTCOME_UNKNOWN",
                outcomeUnknownMessage: "Не вдалося визначити результат видалення об'єкта",
            });
            if (data !== true && data?.success !== true) {
                throw createValidationError(
                    "Meta не підтвердила видалення об'єкта",
                    "PAGE_REBUILD_DELETE_NOT_CONFIRMED"
                );
            }
            return true;
        } catch (error) {
            if (error?.code !== "FACEBOOK_PAGE_OBJECT_DELETE_OUTCOME_UNKNOWN") {
                throw error;
            }
            if (!await this.#pageObjectExists(objectId, page.pageAccessToken)) return true;
            throw error;
        }
    }


    /** Створює backdated feed post з уже завантаженої фотографії. */
    async createBackdatedPhotoPost({ pageId, photoId, backdatedTime } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const timestamp = new Date(backdatedTime);
        if (Number.isNaN(timestamp.getTime()) || timestamp >= new Date()) {
            throw createValidationError(
                "Некоректна минула дата фото-поста",
                "PAGE_REBUILD_BACKDATED_TIME_INVALID"
            );
        }
        const body = new URLSearchParams();
        body.set("attached_media", JSON.stringify([{ media_fbid: String(photoId) }]));
        body.set("backdated_time", timestamp.toISOString());
        body.set("backdated_time_granularity", "day");
        body.set("published", "true");
        const data = await this.#request(`/${page.id}/feed`, {}, {
            method: "post",
            data: body,
            accessToken: page.pageAccessToken,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_BACKDATED_POST_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta створила backdated пост",
        });
        if (!data?.id) {
            throw createValidationError(
                "Meta не повернула ID backdated поста",
                "PAGE_REBUILD_POST_ID_MISSING"
            );
        }
        return { postId: String(data.id) };
    }


    /** Створює звичайний фото-пост без зміни дати публікації. */
    async createCurrentPhotoPost({ pageId, photoId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        const body = new URLSearchParams();
        body.set("attached_media", JSON.stringify([{ media_fbid: String(photoId) }]));
        body.set("published", "true");
        const data = await this.#request(`/${page.id}/feed`, {}, {
            method: "post",
            data: body,
            accessToken: page.pageAccessToken,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_CURRENT_POST_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta створила фото-пост",
        });
        if (!data?.id) {
            throw createValidationError(
                "Meta не повернула ID фото-поста",
                "PAGE_REBUILD_POST_ID_MISSING"
            );
        }
        return { postId: String(data.id) };
    }


    async getPagePhotoStory({ pageId, photoId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        return this.getPhotoPostId({
            photoId,
            pageAccessToken: page.pageAccessToken,
        });
    }


    async getPagePostForPage({ pageId, postId } = {}) {
        const page = await this.#getRebuildPage(pageId);
        return this.getPagePost({
            postId,
            pageAccessToken: page.pageAccessToken,
        });
    }


    async #getCampaignPage(pageId) {
        const normalizedPageId = normalizeObjectId(
            pageId,
            "CAMPAIGN_PAGE_ID_INVALID",
            "ID фанпейджі"
        );
        const page = await this.getFanPageById(normalizedPageId);
        if (!page) {
            throw createValidationError(
                "Немає доступу на керування вибраною фанпейджою",
                "CAMPAIGN_PAGE_ACCESS_DENIED"
            );
        }
        if (!page.tasks.some((task) => (
            pageAdvertiseTasks.has(String(task).toUpperCase())
        ))) {
            throw createValidationError(
                "Немає дозволу ADVERTISE для вибраної фанпейджі",
                "CAMPAIGN_PAGE_ADVERTISE_ACCESS_DENIED"
            );
        }
        return page;
    }


    /** Повертає 10 найновіших опублікованих постів сторінки. */
    async getPagePosts({ pageId, limit = 10 } = {}) {
        const page = await this.#getCampaignPage(pageId);
        const pageSize = Number(limit);
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 25) {
            throw createValidationError(
                "Кількість постів має бути від 1 до 25",
                "CAMPAIGN_POSTS_LIMIT_INVALID"
            );
        }
        const data = await this.#request(`/${page.id}/published_posts`, {
            fields: campaignPostFields,
            limit: pageSize,
        }, { accessToken: page.pageAccessToken });
        const posts = (Array.isArray(data?.data) ? data.data : [])
            .filter((post) => post?.is_published !== false)
            .map(normalizePagePost);

        posts.sort((left, right) => (
            new Date(right.createdTime ?? 0) - new Date(left.createdTime ?? 0)
        ));
        return this.#cachePostPictures(posts.slice(0, pageSize));
    }


    /**
     * Повертає найновіші опубліковані пости з HTTP(S)-посиланням у тексті.
     * Спочатку бере limit найновіших постів, а потім фільтрує цю вибірку.
     */
    async getLatestPagePostsWithLinks({ pageId, limit = 10 } = {}) {
        const normalizedPageId = normalizeObjectId(
            pageId,
            "PAGE_POSTS_PAGE_ID_INVALID",
            "ID фанпейджі"
        );
        const page = await this.getFanPageById(normalizedPageId);
        if (!page) {
            throw createValidationError(
                "Немає доступу на керування вибраною фанпейджою",
                "PAGE_POSTS_ACCESS_DENIED"
            );
        }
        const normalizedLimit = Number(limit);
        if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 25) {
            throw createValidationError(
                "Кількість постів має бути від 1 до 25",
                "PAGE_POSTS_WITH_LINKS_LIMIT_INVALID"
            );
        }

        const posts = await collectLatestPagePostsWithLinks({
            limit: normalizedLimit,
            normalizePost: normalizePagePost,
            fetchPosts: async ({ limit: requestLimit }) => {
                const data = await this.#request(`/${page.id}/published_posts`, {
                    fields: campaignPostFields,
                    limit: requestLimit,
                }, { accessToken: page.pageAccessToken });
                return Array.isArray(data?.data) ? data.data : [];
            },
        });
        return this.#cachePostPictures(posts);
    }


    async getPagePostsSignature({ pageId, limit = 10 } = {}) {
        const page = await this.getFanPageById(pageId);
        if (!page) {
            throw createValidationError(
                "Немає доступу до вибраної фанпейджі",
                "PAGE_POSTS_ACCESS_DENIED"
            );
        }
        const normalizedLimit = Number(limit);
        if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 25) {
            throw createValidationError(
                "Кількість постів має бути від 1 до 25",
                "PAGE_POSTS_SIGNATURE_LIMIT_INVALID"
            );
        }
        const data = await this.#request(`/${page.id}/published_posts`, {
            fields: "id,message,is_published",
            limit: normalizedLimit,
        }, { accessToken: page.pageAccessToken });
        const postIds = (Array.isArray(data?.data) ? data.data : [])
            .filter((post) => (
                post?.is_published !== false
                && /https?:\/\/[^\s]+/i.test(String(post?.message ?? ""))
            ))
            .map((post) => String(post.id));
        return { count: postIds.length, postIds };
    }


    /** Повертає доступні Pixel рекламного акаунта без секретних полів. */
    async getAdPixels(adAccountId) {
        const accountId = normalizeAdAccountId(adAccountId);
        const pixels = await this.#getAll(`/${accountId}/adspixels`, {
            fields: "id,name",
            limit: 100,
        });
        return pixels.filter((pixel) => pixel?.id).map((pixel) => ({
            id: String(pixel.id),
            name: String(pixel.name ?? ""),
        }));
    }


    /** Повертає безпечні для перевірки поля рекламного Creative. */
    async getAdCreativeDetails({ creativeId } = {}) {
        const id = normalizeObjectId(
            creativeId,
            "CAMPAIGN_CREATIVE_ID_INVALID",
            "Creative ID"
        );
        return this.#readObject(id, [
            "id", "name", "effective_object_story_id", "object_story_spec",
            "degrees_of_freedom_spec",
        ]);
    }


    /** Генерує HTML-прев'ю рекламного Creative у вибраному форматі Meta. */
    async getAdCreativePreviews({
        creativeId,
        adFormat = "DESKTOP_FEED_STANDARD",
    } = {}) {
        const id = normalizeObjectId(
            creativeId,
            "CAMPAIGN_CREATIVE_ID_INVALID",
            "Creative ID"
        );
        const data = await this.#request(`/${id}/previews`, {
            ad_format: String(adFormat ?? "").trim(),
        });
        return Array.isArray(data?.data) ? data.data : [];
    }


    /**
     * Видаляє масив публікацій вибраної фанпейджі та повертає частковий результат.
     * Приймає canonical ID або об'єкти з полем id/postId.
     */
    async deletePagePosts({ pageId, posts } = {}) {
        const normalizedPageId = normalizeObjectId(
            pageId,
            "PAGE_POST_DELETE_PAGE_ID_INVALID",
            "ID фанпейджі"
        );
        const page = await this.getFanPageById(normalizedPageId);
        if (!page) {
            throw createValidationError(
                "Немає доступу на керування вибраною фанпейджою",
                "PAGE_POST_DELETE_ACCESS_DENIED"
            );
        }

        return deletePagePostsWorkflow({
            posts,
            deletePost: async (postId) => {
                if (!/^\d+_\d+$/.test(postId) || !postId.startsWith(`${page.id}_`)) {
                    throw createValidationError(
                        "Публікація не належить вибраній фанпейджі",
                        "PAGE_POST_DELETE_OWNERSHIP_MISMATCH"
                    );
                }
                const response = await this.#request(`/${postId}`, {}, {
                    method: "delete",
                    accessToken: page.pageAccessToken,
                    retryOnConnectionError: false,
                    outcomeUnknownCode: "FACEBOOK_POST_DELETE_OUTCOME_UNKNOWN",
                    outcomeUnknownMessage: "Не вдалося визначити, чи Facebook видалив публікацію",
                });
                if (response !== true && response?.success !== true) {
                    throw createValidationError(
                        "Facebook не підтвердив видалення публікації",
                        "FACEBOOK_POST_DELETE_NOT_CONFIRMED"
                    );
                }
            },
        });
    }


    /**
     * Публікує текстовий пост від імені фанпейджі.
     * @param {object} options Дані текстового поста.
     * @param {string} options.pageId ID фанпейджі.
     * @param {string} options.pageAccessToken Page access token.
     * @param {string} options.message Текст поста.
     * @returns {Promise<{postId: string}>}
     * @throws {Error} FACEBOOK_API_ERROR або FACEBOOK_POST_OUTCOME_UNKNOWN.
     */
    async createPageTextPost({
        pageId,
        pageAccessToken,
        message,
    }) {
        const body = new URLSearchParams();
        body.set("message", message);

        const data = await this.#request(`/${pageId}/feed`, {}, {
            method: "post",
            data: body,
            accessToken: pageAccessToken,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            retryOnConnectionError: false,
        });

        return {
            postId: data.id,
        };
    }


    /**
     * Публікує одну фотографію з необов'язковим текстом від імені фанпейджі.
     * @param {object} options Дані фотопоста.
     * @param {string} options.pageId ID фанпейджі.
     * @param {string} options.pageAccessToken Page access token.
     * @param {string} options.message Текст поста.
     * @param {{buffer: Buffer, filename: string, contentType: string}} options.image Файл зображення.
     * @returns {Promise<{postId: string|null, photoId: string|null}>}
     * @throws {Error} FACEBOOK_API_ERROR або FACEBOOK_POST_OUTCOME_UNKNOWN.
     */
    async createPagePhotoPost({
        pageId,
        pageAccessToken,
        message,
        image,
    }) {
        const body = new FormData();
        const photo = new Blob([image.buffer], {
            type: image.contentType,
        });

        body.set("source", photo, image.filename);

        if (message) {
            body.set("message", message);
        }

        const data = await this.#request(`/${pageId}/photos`, {}, {
            method: "post",
            data: body,
            accessToken: pageAccessToken,
            retryOnConnectionError: false,
        });

        return {
            postId: data.post_id ?? data.page_story_id ?? null,
            photoId: data.id ?? null,
        };
    }


    async createPageMultiPhotoPost({ pageId, pageAccessToken, message, images }) {
        const photoIds = [];

        for (const image of images) {
            const body = new FormData();
            body.set("source", new Blob([image.buffer], {
                type: image.contentType,
            }), image.filename);
            body.set("published", "false");
            const data = await this.#request(`/${pageId}/photos`, {}, {
                method: "post",
                data: body,
                accessToken: pageAccessToken,
                retryOnConnectionError: false,
            });
            if (!data?.id) {
                throw createValidationError(
                    "Facebook не повернув ID завантаженої фотографії",
                    "FACEBOOK_POST_PHOTO_ID_MISSING"
                );
            }
            photoIds.push(String(data.id));
        }

        const body = new URLSearchParams();
        body.set("attached_media", JSON.stringify(photoIds.map((photoId) => ({
            media_fbid: photoId,
        }))));
        if (message) body.set("message", message);
        const data = await this.#request(`/${pageId}/feed`, {}, {
            method: "post",
            data: body,
            accessToken: pageAccessToken,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
        });

        return { postId: data?.id ?? null, photoIds };
    }


    /**
     * Приховує автоматично створене Open Graph-прев'ю посилання у пості.
     * Після зміни повторно читає пост, щоб викликальний код міг перевірити
     * фактичні вкладення до створення реклами.
     * @param {object} options Дані поста.
     * @param {string} options.pageId ID фанпейджі.
     * @param {string} options.postId Canonical ID поста або його короткий ID.
     * @returns {Promise<{success: boolean, post: object, attachments: object[]}>}
     */
    async hidePagePostLinkPreview({ pageId, postId } = {}) {
        const normalizedPageId = normalizeObjectId(
            pageId,
            "FACEBOOK_PAGE_ID_INVALID",
            "ID фанпейджі"
        );
        const rawPostId = String(postId ?? "").trim();
        const storyId = rawPostId.includes("_")
            ? rawPostId
            : `${normalizedPageId}_${normalizeObjectId(
                rawPostId,
                "FACEBOOK_POST_ID_INVALID",
                "Post ID"
            )}`;
        if (!storyId.startsWith(`${normalizedPageId}_`)) {
            throw createValidationError(
                "Вказаний пост не належить вибраній фанпейджі",
                "FACEBOOK_POST_PAGE_MISMATCH"
            );
        }

        const page = await this.#getCampaignPage(normalizedPageId);
        const changed = await this.#request(`/${storyId}`, {}, {
            method: "post",
            data: toFormData({ og_hide_object_attachment: true }),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            accessToken: page.pageAccessToken,
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_POST_UPDATE_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta приховала прев'ю посилання. Перевірте пост вручну перед повтором.",
        });
        const post = await this.#request(`/${storyId}`, {
            fields: campaignPostFields,
        }, { accessToken: page.pageAccessToken });

        return {
            success: changed?.success === true,
            post,
            attachments: Array.isArray(post?.attachments?.data)
                ? post.attachments.data
                : [],
        };
    }


    /**
     * Отримує ID поста, створеного під час завантаження фотографії.
     * @param {object} options Дані фотографії.
     * @param {string} options.photoId ID фотографії.
     * @param {string} options.pageAccessToken Page access token.
     * @returns {Promise<string|null>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getPhotoPostId({ photoId, pageAccessToken }) {
        const data = await this.#request(`/${photoId}`, {
            fields: "page_story_id",
        }, {
            accessToken: pageAccessToken,
        });

        return data.page_story_id ?? null;
    }


    /**
     * Отримує створений пост для підтвердження публікації.
     * @param {object} options Дані поста.
     * @param {string} options.postId ID поста.
     * @param {string} options.pageAccessToken Page access token.
     * @returns {Promise<object>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getPagePost({ postId, pageAccessToken }) {
        const data = await this.#request(`/${postId}`, {
            fields: [
                "id",
                "message",
                "created_time",
                "permalink_url",
                "is_published",
                "status_type",
            ].join(","),
        }, {
            accessToken: pageAccessToken,
        });

        return {
            id: data.id,
            message: data.message ?? "",
            createdTime: data.created_time ?? null,
            permalinkUrl: data.permalink_url ?? null,
            isPublished: data.is_published ?? null,
            statusType: data.status_type ?? null,
        };
    }


    async #writeObject(pathname, fields, { validateOnly = false } = {}) {
        return this.#request(pathname, {}, {
            method: "post",
            data: toFormData(fields, validateOnly),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_WRITE_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta застосувала зміну. Не повторюйте операцію до ручної перевірки Ads Manager.",
        });
    }


    async #uploadAdImage(adAccountId, image) {
        const body = new FormData();
        body.set("filename", new Blob([image.buffer], {
            type: image.contentType,
        }), image.filename);
        const data = await this.#request(`/${adAccountId}/adimages`, {}, {
            method: "post",
            data: body,
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_WRITE_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta завантажила рекламне зображення. Перевірте Ads Manager перед повтором.",
        });
        const uploaded = Object.values(data.images ?? {})[0];
        if (!uploaded?.hash) {
            throw createValidationError(
                "Meta не повернула hash завантаженого рекламного зображення",
                "CAMPAIGN_AD_IMAGE_HASH_MISSING"
            );
        }
        return uploaded.hash;
    }


    async #readObject(id, fields) {
        return this.#request(`/${id}`, { fields: fields.join(",") });
    }


    async preflightLeadCampaign({
        adAccountId,
        pageId,
        postId,
        template,
        pixelId,
        dailyBudget,
        startTime,
        creativeMode = "post",
        siteUrl = "",
    }) {
        const accountId = normalizeAdAccountId(adAccountId);
        const normalizedPageId = normalizeObjectId(
            pageId,
            "CAMPAIGN_PAGE_ID_INVALID",
            "ID фанпейджі"
        );
        const imageCreative = creativeMode === "image";
        let storyId = null;
        if (imageCreative) {
            let destination;
            try {
                destination = new URL(String(siteUrl ?? "").trim());
            } catch {
                throw createValidationError(
                    "Вкажіть коректне посилання на офер",
                    "CAMPAIGN_SITE_URL_INVALID"
                );
            }
            if (!["http:", "https:"].includes(destination.protocol)) {
                throw createValidationError(
                    "Посилання на офер має починатися з http:// або https://",
                    "CAMPAIGN_SITE_URL_INVALID"
                );
            }
        } else {
            const rawPostId = String(postId ?? "").trim();
            storyId = rawPostId.includes("_")
                ? rawPostId
                : `${normalizedPageId}_${normalizeObjectId(
                    rawPostId,
                    "CAMPAIGN_POST_ID_INVALID",
                    "Post ID"
                )}`;
            if (!storyId.startsWith(`${normalizedPageId}_`)) {
                throw createValidationError(
                    "Вказаний пост не належить вибраній фанпейджі",
                    "CAMPAIGN_POST_PAGE_MISMATCH"
                );
            }
        }
        if (!pixelId) {
            throw createValidationError(
                "Не вказано Pixel ID",
                "CAMPAIGN_PIXEL_REQUIRED"
            );
        }
        if (!Array.isArray(template.countryCodes) || !template.countryCodes.length) {
            throw createValidationError(
                "У шаблоні потрібно вибрати хоча б одну країну",
                "CAMPAIGN_COUNTRY_REQUIRED"
            );
        }

        const normalizedStart = new Date(startTime);
        if (Number.isNaN(normalizedStart.getTime())) {
            throw createValidationError(
                "Некоректний час початку показів",
                "CAMPAIGN_START_TIME_INVALID"
            );
        }

        const permissions = await this.getPermissions();
        if (!permissions.granted.includes("ads_management")) {
            throw createValidationError(
                "Access token не має дозволу ads_management",
                "CAMPAIGN_ADS_MANAGEMENT_REQUIRED"
            );
        }

        const account = await this.#request(`/${accountId}`, {
            fields: [
                "id",
                "name",
                "account_status",
                "currency",
                "timezone_name",
                "default_dsa_beneficiary",
                "default_dsa_payor",
            ].join(","),
        });
        if (Number(account.account_status) !== 1) {
            throw createValidationError(
                `Рекламний акаунт неактивний (status ${account.account_status})`,
                "CAMPAIGN_AD_ACCOUNT_INACTIVE"
            );
        }

        const page = await this.#getCampaignPage(normalizedPageId);
        if (!imageCreative) {
            const post = await this.#request(`/${storyId}`, {
                fields: campaignPostFields,
            }, { accessToken: page.pageAccessToken });
            if (post.is_published === false) {
                throw createValidationError(
                    "Пост не опублікований",
                    "CAMPAIGN_POST_NOT_PUBLISHED"
                );
            }
            if (!hasExternalWebsiteUrl(post)) {
                throw createValidationError(
                    "У пості не знайдено посилання на зовнішній сайт",
                    "CAMPAIGN_POST_WEBSITE_URL_REQUIRED"
                );
            }
        }

        const pixels = await this.#getAll(`/${accountId}/adspixels`, {
            fields: "id,name",
            limit: 100,
        });
        const normalizedPixelId = normalizeObjectId(
            pixelId,
            "CAMPAIGN_PIXEL_ID_INVALID",
            "Pixel ID"
        );
        const pixel = pixels.find((item) => String(item.id) === normalizedPixelId);
        if (!pixel) {
            throw createValidationError(
                "Вибраний Pixel недоступний цьому рекламному акаунту",
                "CAMPAIGN_PIXEL_ACCESS_DENIED"
            );
        }

        let instagramActorId = null;
        if (template.placements?.instagram?.length) {
            const pageDetails = await this.#request(`/${normalizedPageId}`, {
                fields: "instagram_business_account{id,username}",
            }, { accessToken: page.pageAccessToken });
            instagramActorId = pageDetails.instagram_business_account?.id ?? null;
            if (!instagramActorId) {
                throw createValidationError(
                    "Для Instagram placements до фанпейджі має бути прив’язаний Instagram business account",
                    "CAMPAIGN_INSTAGRAM_ACTOR_REQUIRED"
                );
            }
        }

        const budgetMinor = budgetToMinorUnits(dailyBudget, account.currency);
        const dsa = resolveDsaSettings(template, account);
        const campaignFields = {
            name: "AdsBot preflight",
            objective: "OUTCOME_LEADS",
            status: "PAUSED",
            special_ad_categories: [],
            bid_strategy: "LOWEST_COST_WITHOUT_CAP",
            is_adset_budget_sharing_enabled: template.shareAdSetBudget,
        };
        await this.#writeObject(`/${accountId}/campaigns`, campaignFields, {
            validateOnly: true,
        });

        return {
            adAccountId: accountId,
            accountName: account.name ?? "",
            currency: account.currency,
            timezoneName: account.timezone_name,
            pageId: normalizedPageId,
            pageName: page.name,
            postId: storyId,
            pixel: { id: pixel.id, name: pixel.name ?? "" },
            instagramActorId,
            dailyBudgetMinor: budgetMinor,
            startTime: normalizedStart.toISOString(),
            targeting: buildTargeting(template),
            dsa,
        };
    }


    async createLeadCampaign(options, onProgress = () => {}) {
        const {
            campaignName,
            template,
            adSetCount,
            createPaused = true,
            createAdSetsPaused = true,
            createAdsPaused = true,
            adCreative = null,
            utm = "",
            resume = {},
        } = options;
        const count = Number(adSetCount);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
            throw createValidationError(
                "Кількість ad sets має бути від 1 до 100",
                "CAMPAIGN_ADSET_COUNT_INVALID"
            );
        }
        const name = String(campaignName ?? "").trim();
        if (!name) {
            throw createValidationError(
                "Вкажіть назву кампанії",
                "CAMPAIGN_NAME_REQUIRED"
            );
        }
        const objects = {
            campaignId: resume.campaignId ?? null,
            creativeId: resume.creativeId ?? null,
            adSets: Array.isArray(resume.adSets) ? [...resume.adSets] : [],
            ads: Array.isArray(resume.ads) ? [...resume.ads] : [],
        };
        const emit = async (stage, detail = {}) => onProgress({
            stage,
            objects: structuredClone(objects),
            ...detail,
        });
        let currentStage = "preflight";
        let currentIndex = null;

        try {
            await emit("preflight", { message: "Перевіряємо доступи та ресурси" });
            const preflight = await this.preflightLeadCampaign(options);
            await emit("preflight-complete", { preflight });

            currentStage = "campaign";
            if (!objects.campaignId) {
                const created = await this.#writeObject(
                    `/${preflight.adAccountId}/campaigns`,
                    {
                        name,
                        objective: "OUTCOME_LEADS",
                        status: "PAUSED",
                        special_ad_categories: [],
                        bid_strategy: "LOWEST_COST_WITHOUT_CAP",
                        is_adset_budget_sharing_enabled:
                            template.shareAdSetBudget,
                    }
                );
                objects.campaignId = created.id;
                await emit("campaign", { message: "Campaign створено" });
            }

            currentStage = "creative";
            if (!objects.creativeId) {
                let creativeFields;
                if (options.creativeMode === "image") {
                    if (!adCreative?.image) {
                        throw createValidationError(
                            "Не передано зображення рекламного оголошення",
                            "CAMPAIGN_AD_IMAGE_REQUIRED"
                        );
                    }
                    const imageHash = await this.#uploadAdImage(
                        preflight.adAccountId,
                        adCreative.image
                    );
                    const callToActionType = String(
                        adCreative.callToActionType ?? "NO_BUTTON"
                    ).trim().toUpperCase();
                    if (!new Set([
                        "NO_BUTTON",
                        "LEARN_MORE",
                        "SHOP_NOW",
                        "SIGN_UP",
                    ]).has(callToActionType)) {
                        throw createValidationError(
                            "Непідтримуваний тип кнопки рекламного оголошення",
                            "CAMPAIGN_AD_CALL_TO_ACTION_INVALID"
                        );
                    }
                    creativeFields = {
                        name: `${name} | Creative`,
                        object_story_spec: {
                            page_id: preflight.pageId,
                            link_data: {
                                image_hash: imageHash,
                                link: String(adCreative.siteUrl ?? "").trim(),
                                name: String(adCreative.headline ?? "").trim(),
                                message: String(adCreative.primaryText ?? "").trim(),
                                ...(callToActionType !== "NO_BUTTON" ? {
                                    call_to_action: {
                                        type: callToActionType,
                                        value: {
                                            link: String(adCreative.siteUrl ?? "").trim(),
                                        },
                                    },
                                } : {}),
                            },
                        },
                        url_tags: String(utm ?? "").trim(),
                        degrees_of_freedom_spec: buildEnhancementsOptOut(),
                        ...(preflight.instagramActorId
                            ? { instagram_actor_id: preflight.instagramActorId }
                            : {}),
                    };
                } else {
                    creativeFields = {
                        name: `${name} | Creative`,
                        object_story_id: preflight.postId,
                        url_tags: String(utm ?? "").trim(),
                        degrees_of_freedom_spec: buildEnhancementsOptOut(),
                        ...(preflight.instagramActorId
                            ? { instagram_actor_id: preflight.instagramActorId }
                            : {}),
                    };
                }
                await this.#writeObject(
                    `/${preflight.adAccountId}/adcreatives`,
                    creativeFields,
                    { validateOnly: true }
                );
                const created = await this.#writeObject(
                    `/${preflight.adAccountId}/adcreatives`,
                    creativeFields
                );
                objects.creativeId = created.id;
                await emit("creative", { message: "Creative створено" });
            }

            for (let index = 0; index < count; index += 1) {
                currentIndex = index;
                const ordinal = String(index + 1).padStart(2, "0");
                let adSet = objects.adSets.find((item) => item.index === index);
                currentStage = "adset";
                if (!adSet?.id) {
                    const fields = {
                        name: `${name} | AS ${ordinal}`,
                        campaign_id: objects.campaignId,
                        daily_budget: preflight.dailyBudgetMinor,
                        billing_event: "IMPRESSIONS",
                        optimization_goal: "OFFSITE_CONVERSIONS",
                        promoted_object: {
                            pixel_id: preflight.pixel.id,
                            custom_event_type: "LEAD",
                        },
                        targeting: preflight.targeting,
                        start_time: preflight.startTime,
                        status: "PAUSED",
                        ...(preflight.dsa ? {
                            dsa_beneficiary: preflight.dsa.beneficiary,
                            dsa_payor: preflight.dsa.payor,
                        } : {}),
                    };
                    await this.#writeObject(
                        `/${preflight.adAccountId}/adsets`,
                        fields,
                        { validateOnly: true }
                    );
                    const created = await this.#writeObject(
                        `/${preflight.adAccountId}/adsets`,
                        fields
                    );
                    adSet = { index, id: created.id, name: fields.name };
                    objects.adSets.push(adSet);
                    await emit("adset", {
                        index,
                        message: `Ad set ${index + 1}/${count} створено`,
                    });
                }

                currentStage = "ad";
                if (!objects.ads.some((item) => item.index === index && item.id)) {
                    const fields = {
                        name: `${name} | AD ${ordinal}`,
                        adset_id: adSet.id,
                        creative: { creative_id: objects.creativeId },
                        status: "PAUSED",
                    };
                    await this.#writeObject(
                        `/${preflight.adAccountId}/ads`,
                        fields,
                        { validateOnly: true }
                    );
                    const created = await this.#writeObject(
                        `/${preflight.adAccountId}/ads`,
                        fields
                    );
                    objects.ads.push({ index, id: created.id, name: fields.name });
                    await emit("ad", {
                        index,
                        message: `Ad ${index + 1}/${count} створено`,
                    });
                }
            }

            if (!createAdsPaused || !createAdSetsPaused || !createPaused) {
                currentStage = "activation";
                if (!createAdsPaused) {
                    for (const ad of objects.ads) {
                        await this.#writeObject(`/${ad.id}`, { status: "ACTIVE" });
                    }
                }
                if (!createAdSetsPaused) {
                    for (const adSet of objects.adSets) {
                        await this.#writeObject(`/${adSet.id}`, { status: "ACTIVE" });
                    }
                }
                if (!createPaused) {
                    await this.#writeObject(`/${objects.campaignId}`, {
                        status: "ACTIVE",
                    });
                }
                await emit("activation", { message: "Вибрані об’єкти активовано" });
            }

            currentStage = "readback";
            await emit("readback", { message: "Перевіряємо створені об’єкти" });
            const [campaignReadback, creativeReadback, adSetsReadback, adsReadback] = await Promise.all([
                this.#readObject(
                    objects.campaignId,
                    ["id", "name", "status", "effective_status"]
                ),
                this.#readObject(
                    objects.creativeId,
                    [
                        "id", "name", "degrees_of_freedom_spec",
                        "effective_object_story_id", "object_story_spec",
                    ]
                ),
                Promise.all(objects.adSets.map((item) => this.#readObject(
                    item.id,
                    [
                        "id", "name", "status", "effective_status",
                        "start_time", "daily_budget", "targeting",
                        "promoted_object", "dsa_beneficiary", "dsa_payor",
                    ]
                ))),
                Promise.all(objects.ads.map((item) => this.#readObject(
                    item.id,
                    ["id", "name", "status", "effective_status", "creative"]
                ))),
            ]);
            const returnedFeatures = creativeReadback
                ?.degrees_of_freedom_spec
                ?.creative_features_spec;
            const warnings = [];
            if (!returnedFeatures) {
                warnings.push(
                    "Meta не повернула creative_features_spec для контрольної перевірки"
                );
            } else {
                const mismatched = disabledCreativeFeatures.filter((feature) => (
                    returnedFeatures[feature]
                    && returnedFeatures[feature].enroll_status !== "OPT_OUT"
                ));
                if (mismatched.length) {
                    warnings.push(
                        `Meta не підтвердила OPT_OUT: ${mismatched.join(", ")}`
                    );
                }
            }
            if (preflight.dsa) {
                adSetsReadback.forEach((adSet, index) => {
                    if (
                        adSet.dsa_beneficiary !== preflight.dsa.beneficiary
                        || adSet.dsa_payor !== preflight.dsa.payor
                    ) {
                        warnings.push(
                            `Ad set ${index + 1}: Meta не підтвердила очікувані DSA beneficiary/payor`
                        );
                    }
                });
            }
            const readback = {
                campaign: campaignReadback,
                creative: creativeReadback,
                adSets: adSetsReadback,
                ads: adsReadback,
                warnings,
            };

            await emit("complete", { message: "Створення завершено" });
            return { objects, preflight, readback, createPaused };
        } catch (error) {
            error.stage = currentStage;
            error.itemIndex = currentIndex;
            error.createdObjects = structuredClone(objects);
            throw error;
        }
    }


    async deleteCampaignDraft(objects = {}, onProgress = () => {}) {
        const result = { deleted: [], failed: [] };
        const remove = async (type, id) => {
            try {
                await this.#request(`/${id}`, {}, {
                    method: "delete",
                    retryOnConnectionError: false,
                    outcomeUnknownCode: "FACEBOOK_WRITE_OUTCOME_UNKNOWN",
                    outcomeUnknownMessage: "Не вдалося визначити, чи Meta видалила об’єкт. Перевірте Ads Manager перед повтором.",
                });
                result.deleted.push({ type, id });
                await onProgress({ type, id, deleted: true });
            } catch (error) {
                result.failed.push({
                    type,
                    id,
                    message: error.message,
                    code: error.code ?? null,
                });
                await onProgress({ type, id, deleted: false });
            }
        };

        for (const ad of [...(objects.ads ?? [])].reverse()) {
            if (ad.id) await remove("ad", ad.id);
        }
        for (const adSet of [...(objects.adSets ?? [])].reverse()) {
            if (adSet.id) await remove("adset", adSet.id);
        }
        if (objects.creativeId) await remove("creative", objects.creativeId);
        if (objects.campaignId) await remove("campaign", objects.campaignId);
        return result;
    }
}
