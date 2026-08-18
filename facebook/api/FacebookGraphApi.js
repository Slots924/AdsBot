function createFacebookApiError(error) {
    if (error?.code === "PROXY_POOL_EXHAUSTED") {
        return error;
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


export default class FacebookGraphApi {
    #accessToken;
    #cookie;
    #proxyHttpClient;


    constructor({
        accountKey,
        accessToken,
        cookie,
        userAgent,
        proxyHttpClient,
    }) {
        if (!proxyHttpClient?.request) {
            throw new Error("Не передано ProxyHttpClient");
        }

        this.accountKey = accountKey;
        this.userAgent = userAgent;
        this.apiUrl = "https://graph.facebook.com/v26.0";
        this.#accessToken = accessToken;
        this.#cookie = cookie;
        this.#proxyHttpClient = proxyHttpClient;
    }


    async #request(pathname, params = {}) {
        const normalizedPathname = String(pathname).startsWith("/")
            ? pathname
            : `/${pathname}`;

        try {
            const response = await this.#proxyHttpClient.request({
                method: "get",
                url: `${this.apiUrl}${normalizedPathname}`,
                params,
                headers: {
                    Accept: "application/json",
                    Authorization: `Bearer ${this.#accessToken}`,
                    Cookie: this.#cookie,
                    "User-Agent": this.userAgent,
                },
                timeout: 30000,
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
}
