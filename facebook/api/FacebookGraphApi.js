function createFacebookApiError(error) {
    if (error?.code === "PROXY_POOL_EXHAUSTED") {
        return error;
    }

    if (error?.code === "PROXY_REQUEST_OUTCOME_UNKNOWN") {
        const outcomeError = new Error(
            "Не вдалося визначити, чи Facebook опублікував пост"
        );
        outcomeError.code = "FACEBOOK_POST_OUTCOME_UNKNOWN";
        return outcomeError;
    }

    const graphError = error?.response?.data?.error;
    const facebookError = new Error(
        graphError?.message
        || "Не вдалося виконати запит Facebook API"
    );

    facebookError.code = "FACEBOOK_API_ERROR";
    facebookError.httpStatus = error?.response?.status ?? null;
    facebookError.graphCode = graphError?.code ?? null;
    facebookError.graphSubcode = graphError?.error_subcode ?? null;
    facebookError.graphType = graphError?.type ?? null;

    return facebookError;
}


const pagePublishTasks = new Set([
    "CREATE_CONTENT",
    "MANAGE",
    "PROFILE_PLUS_CREATE_CONTENT",
    "PROFILE_PLUS_MANAGE",
    "PROFILE_PLUS_FULL_CONTROL",
]);


function hasPagePublishTask(tasks) {
    return Array.isArray(tasks)
        && tasks.some((task) =>
            pagePublishTasks.has(String(task ?? "").trim().toUpperCase())
        );
}


export default class FacebookGraphApi {
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
    } = {}) {
        const normalizedPathname = String(pathname).startsWith("/")
            ? pathname
            : `/${pathname}`;

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

            return response.data;
        } catch (error) {
            throw createFacebookApiError(error);
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
                "created_time",
                "amount_spent",
                "balance",
                "spend_cap",
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
            createdTime: account.created_time ?? null,
            amountSpent: account.amount_spent ?? null,
            balance: account.balance ?? null,
            spendCap: account.spend_cap ?? null,
            owner: account.owner ?? null,
            business: account.business ?? null,
        }));
    }


    /**
     * Повертає всі доступні fan pages разом із Page access tokens.
     * @returns {Promise<object[]>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getPages() {
        const pages = await this.#getAll("/me/accounts", {
            fields: "id,name,category,tasks,access_token",
        });

        return pages.map((page) => ({
            id: page.id,
            name: page.name,
            category: page.category,
            tasks: page.tasks ?? [],
            pageAccessToken: page.access_token,
        }));
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


    /**
     * Повертає безпечний список фанпейджів без Page access tokens.
     * @returns {Promise<Array<{id: string, name: string}>>}
     * @throws {Error} FACEBOOK_API_ERROR або PROXY_POOL_EXHAUSTED.
     */
    async getAvailablePages() {
        const pages = await this.getPages();
        const checkedPages = await Promise.all(
            pages.map((page) => this.#getPublishablePage(page))
        );

        return checkedPages
            .filter(Boolean)
            .map((page) => ({
                id: page.id,
                name: page.name,
            }));
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
}
