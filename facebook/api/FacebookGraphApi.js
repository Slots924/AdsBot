import { createValidationError, normalizeAdAccountId, normalizeObjectId } from "./validation.js";
import preflightLeadCampaignWorkflow from "../workflows/preflightLeadCampaign.js";
import createLeadCampaignWorkflow from "../workflows/createLeadCampaign.js";
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
        kind = "api",
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
        this.kind = kind;
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
                    ...(String(this.#cookie ?? "").trim() ? { Cookie: this.#cookie } : {}),
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


    /** Повертає бізнеси, доступні поточному токену Graph API. */
    async getBusinessManagers() {
        if (this.kind === "system") return this.getSystemUserBusinessManagers();
        const businesses = await this.#getAll("/me/businesses", {
            fields: "id,name,verification_status,created_time",
            limit: 100,
        });

        return businesses.map((business) => ({
            id: String(business.id ?? ""),
            name: String(business.name ?? ""),
            verificationStatus: business.verification_status ?? null,
            createdTime: business.created_time ?? null,
        }));
    }

    /** Визначає власний БМ системного юзера і перевіряє його членство. */
    async getSystemUserBusinessManagers({ knownBusinessIds = [] } = {}) {
        const me = await this.#request("/me", { fields: "id,name" });
        const userId = this.#businessId(me?.id);
        const candidates = new Set();
        const diagnostics = [];
        const addCandidate = (value) => { if (/^\d+$/.test(String(value ?? ""))) candidates.add(String(value)); };
        knownBusinessIds.forEach(addCandidate);
        const attempt = async (stage, action) => {
            try { return await action(); }
            catch (error) { diagnostics.push({ stage, code: error.code, graphCode: error.graphCode, graphSubcode: error.graphSubcode, message: redactSensitiveText(error.message).replace(/\d+/g, "[ID]") }); return null; }
        };
        const checked = new Set();
        const verify = async () => {
            for (const businessId of candidates) {
                if (checked.has(businessId)) continue;
                checked.add(businessId);
                const users = await attempt("business-membership", () => this.#getAll(`/${businessId}/system_users`, { fields: "id", limit: 100 }));
                if (!users?.some((user) => String(user.id) === userId)) continue;
                const business = await this.#request(`/${businessId}`, { fields: "id,name,verification_status,created_time" });
                return [{ id: String(business.id), name: String(business.name ?? ""), verificationStatus: business.verification_status ?? null, createdTime: business.created_time ?? null }];
            }
            return null;
        };
        const fromCache = await verify();
        if (fromCache) return fromCache;
        const metadata = (await attempt("token-metadata", () => this.#request("/debug_token", { input_token: this.#accessToken })))?.data;
        addCandidate(metadata?.business_id);
        for (const scope of metadata?.granular_scopes ?? []) {
            if (scope.scope === "business_management") (scope.target_ids ?? []).forEach(addCandidate);
        }
        if (metadata?.app_id) {
            const app = await attempt("application-business", () => this.#request(`/${this.#businessId(metadata.app_id)}`, { fields: "id,business{id,name}" }));
            addCandidate(app?.business?.id);
        }
        const memberships = await attempt("business-user-memberships", () => this.#getAll("/me/business_users", { fields: "business{id,name}", limit: 100 }));
        for (const membership of memberships ?? []) addCandidate(membership.business?.id);
        const fromApp = await verify();
        if (fromApp) return fromApp;
        const accounts = await attempt("assigned-account-businesses", () => this.#getAll(`/${userId}/assigned_ad_accounts`, { fields: "id,business{id,name}", limit: 100 }));
        for (const account of accounts ?? []) addCandidate(account.business?.id);
        const fromAssets = await verify();
        if (fromAssets) return fromAssets;
        getLogger("facebook-graph", { accountKey: this.accountKey }).warn("bm.system-discovery.failed", "Не вдалося визначити власний БМ системного юзера", { diagnostics, candidateCount: candidates.size });
        const error = new Error("Не вдалося визначити власний БМ системного юзера. Додайте у вкладці API-клієнти БМ-клієнта з доступом до цього бізнесу та перевірте дозвіл business_management системного токена");
        error.code = "SYSTEM_USER_BUSINESS_NOT_DISCOVERED";
        throw error;
    }


    /** Повертає призначені системному користувачу фанки або РК без токенів сторінок. */
    async getSystemUserAssignedAssets(kind) {
        if (this.kind !== "system" || !["pages", "ad_accounts"].includes(kind)) throw new Error("Оберіть активи системного користувача");
        const me = await this.getMe();
        return this.#getAll(`/${this.#businessId(me.id)}/assigned_${kind}`, {
            fields: kind === "pages" ? "id,name" : "id,name,account_id,account_status,business{id,name}", limit: 100,
        });
    }

    async #getBusinessAssets(businessId, kind, fields) {
        const id = this.#businessId(businessId);
        const edge = (name) => this.#getAll(`/${id}/${name}_${kind}`, { fields, limit: 100 });
        const [owned, shared] = await Promise.all([edge("owned"), edge("client")]);
        return [...new Map([...shared.map((item) => ({ ...item, ownership: "shared" })), ...owned.map((item) => ({ ...item, ownership: "owned" }))].map((item) => [String(item.id), { ...item, id: String(item.id) }])).values()];
    }

    /** Повертає власні та надані фанки БМ незалежно від призначення поточному юзеру. */
    async getBusinessPages(businessId) {
        return this.#getBusinessAssets(businessId, "pages", "id,name");
    }

    /** Читає доступ, користувачів та активи одного Business Manager. */
    async getBusinessManagementSection(businessId, section) {
        const id = this.#businessId(businessId);
        const edge = (name, fields) => this.#getAll(`/${id}/${name}`, { fields, limit: 100 });
        const assets = (kind, fields) => this.#getBusinessAssets(id, kind, fields);
        const adAccounts = () => assets("ad_accounts", "id,name,account_id,account_status,currency,business{id,name}");
        if (section === "pages") return { pages: await this.getBusinessPages(id) };
        if (section === "adAccounts") return { adAccounts: await adAccounts() };
        if (section === "users") {
            const [users, pending, systemUsers, pages, accounts] = await Promise.all([
                edge("business_users", "id,name,first_name,last_name,email,pending_email,role,finance_permission,tasks"),
                edge("pending_users", "id,email,role"),
                edge("system_users", "id,name"),
                this.getBusinessPages(id), adAccounts(),
            ]);
            const systemIds = new Set(systemUsers.map((user) => String(user.id)));
            const people = users.filter((user) => !systemIds.has(String(user.id)) && ["ADMIN", "EMPLOYEE", "DEFAULT"].includes(user.role));
            // Обмежуємо одночасні запити до призначень активів.
            const all = [...pages, ...accounts];
            for (let offset = 0; offset < all.length; offset += 4) {
                await Promise.all(all.slice(offset, offset + 4).map(async (asset) => {
                    try {
                        asset.assignedUsers = await this.#getAll(`/${asset.id}/assigned_users`, { business: id, fields: "id,name,tasks", limit: 100 });
                    } catch (error) {
                        asset.assignmentError = { message: error.message, code: error.graphCode ?? error.code };
                    }
                }));
            }
            return { users: people, pending, pages, adAccounts: accounts };
        }
        if (section === "pixels") {
            const [pixels, accounts] = await Promise.all([assets("pixels", "id,name"), adAccounts()]);
            for (const pixel of pixels) {
                try {
                    pixel.sharedAccounts = await this.#getAll(`/${pixel.id}/shared_accounts`, { business: id, fields: "id,name,account_id", limit: 100 });
                } catch (error) {
                    pixel.assignmentError = { message: error.message, code: error.graphCode ?? error.code };
                }
            }
            return { pixels, adAccounts: accounts };
        }
        throw new Error("Невідомий розділ БМ");
    }

    #businessId(value) {
        const id = String(value ?? "").trim();
        if (!/^\d+$/.test(id)) throw new Error("Некоректний ID БМ, користувача або активу");
        return id;
    }

    async #businessMutation(pathname, parameters, method = "post") {
        const result = await this.#request(pathname, {}, {
            method, data: new URLSearchParams(parameters),
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_BUSINESS_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Результат зміни БМ невідомий. Оновіть дані перед повторною спробою",
        });
        if (result === false || result?.success === false) throw new Error("Meta не підтвердила виконання операції");
        return result;
    }

    /** Знімає призначення користувача з одного активу. */
    removeBusinessUserFromAsset({ assetId, userId }) {
        const asset = String(assetId ?? "").replace(/^act_/, "");
        this.#businessId(asset);
        return this.#businessMutation(`/${String(assetId)}/assigned_users`, { user: this.#businessId(userId) }, "delete");
    }

    /** Видаляє бізнес-користувача з БМ. */
    removeBusinessUser(userId) {
        return this.#businessMutation(`/${this.#businessId(userId)}`, {}, "delete");
    }

    /** Змінює ім'я саме бізнес-користувача. */
    renameBusinessUser({ userId, firstName, lastName = "" }) {
        if (!String(firstName ?? "").trim()) throw new Error("Вкажіть ім’я користувача");
        return this.#businessMutation(`/${this.#businessId(userId)}`, { first_name: String(firstName).trim(), last_name: String(lastName).trim() });
    }

    /** Змінює зв'язок пікселя з рекламним акаунтом у поточному БМ. */
    setBusinessPixelAccount({ pixelId, accountId, businessId, enabled }) {
        return this.#businessMutation(`/${this.#businessId(pixelId)}/shared_accounts`, {
            account_id: this.#businessId(String(accountId).replace(/^act_/, "")), business: this.#businessId(businessId),
        }, enabled ? "post" : "delete");
    }

    /** Прибирає доступ поточного БМ до наданого рекламного акаунта. */
    removeSharedBusinessAdAccount({ accountId, businessId }) {
        return this.#businessMutation(`/act_${this.#businessId(String(accountId).replace(/^act_/, ""))}/agencies`, { business: this.#businessId(businessId) }, "delete");
    }

    async getBusinessManagerSnapshot(businessId, { systemUserId = "" } = {}) {
        const id = String(businessId ?? "").trim();
        if (!/^\d+$/.test(id)) {
            throw new Error("Некоректний ID Business Manager");
        }

        const readEdge = async (pathname, params = {}) => {
            try {
                return { data: await this.#getAll(pathname, { limit: 100, ...params }) };
            } catch (error) {
                return { error: {
                    message: error.message,
                    code: error.graphCode ?? null,
                    subcode: error.graphSubcode ?? null,
                } };
            }
        };
        const readNode = async (pathname, params = {}) => {
            try {
                return { data: await this.#request(pathname, params) };
            } catch (error) {
                return { error: {
                    message: error.message,
                    code: error.graphCode ?? null,
                    subcode: error.graphSubcode ?? null,
                } };
            }
        };

        const [business, systemUsers, businessUsers, pendingUsers, ownedAdAccounts, clientAdAccounts,
            ownedPixels, clientPixels, ownedPages, clientPages] = await Promise.all([
            readNode(`/${id}`, { fields: "id,name,verification_status,created_time" }),
            readEdge(`/${id}/system_users`, { fields: "id,name" }),
            readEdge(`/${id}/business_users`, {
                fields: "id,name,email,pending_email,role,finance_permission,tasks",
            }),
            readEdge(`/${id}/pending_users`),
            readEdge(`/${id}/owned_ad_accounts`, { fields: "id,name,account_id,account_status,currency" }),
            readEdge(`/${id}/client_ad_accounts`, { fields: "id,name,account_id,account_status,currency" }),
            readEdge(`/${id}/owned_pixels`, { fields: "id,name" }),
            readEdge(`/${id}/client_pixels`, { fields: "id,name" }),
            readEdge(`/${id}/owned_pages`, { fields: "id,name" }),
            readEdge(`/${id}/client_pages`, { fields: "id,name" }),
        ]);

        const targetSystemUserId = String(systemUserId ?? "").trim();
        const systemUser = systemUsers.data?.find((item) => String(item.id) === targetSystemUserId) ?? null;
        const adAccounts = [
            ...(ownedAdAccounts.data ?? []),
            ...(clientAdAccounts.data ?? []),
        ];
        const pixels = [
            ...(ownedPixels.data ?? []),
            ...(clientPixels.data ?? []),
        ];

        const [assignedAdAccounts, adAccountDetails, pixelAssignments] = await Promise.all([
            targetSystemUserId
                ? readEdge(`/${targetSystemUserId}/assigned_ad_accounts`, {
                    fields: "id,name,account_id,account_status,currency",
                })
                : Promise.resolve(null),
            Promise.all(adAccounts.map(async (account) => {
                const accountId = String(account.id ?? "");
                const [campaigns, adsets, assignedUsers] = await Promise.all([
                    readEdge(`/${accountId}/campaigns`, { fields: "id,name,status,effective_status" }),
                    readEdge(`/${accountId}/adsets`, { fields: "id,name,status,effective_status,campaign_id" }),
                    readEdge(`/${accountId}/assigned_users`, {
                        fields: "id,name,tasks",
                        business: id,
                    }),
                ]);
                return {
                    account,
                    campaigns,
                    adsets,
                    assignedUsers,
                };
            })),
            Promise.all(pixels.map(async (pixel) => ({
                pixel,
                assignedUsers: await readEdge(`/${String(pixel.id ?? "")}/assigned_users`, {
                    fields: "id,name,tasks",
                    business: id,
                }),
            }))),
        ]);

        return {
            business,
            systemUsers,
            systemUser,
            businessUsers,
            pendingUsers,
            ownedAdAccounts,
            clientAdAccounts,
            assignedAdAccounts,
            adAccountDetails,
            ownedPixels,
            clientPixels,
            pixelAssignments,
            ownedPages,
            clientPages,
        };
    }


    /** Надсилає запрошення користувачу в Business Manager із базовою роллю та фінансовим рівнем. */
    async inviteBusinessUser({
        businessId,
        email,
        role = "EMPLOYEE",
        financePermission = "FINANCE_EDITOR",
        useTasks = false,
    } = {}) {
        const id = String(businessId ?? "").trim();
        const normalizedEmail = String(email ?? "").trim();
        if (!/^\d+$/.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            throw new Error("Некоректний ID Business Manager або email користувача");
        }
        if (!["EMPLOYEE", "ADMIN"].includes(role)) {
            throw new Error("Дозволено лише роль EMPLOYEE або ADMIN");
        }

        const body = new URLSearchParams({
            email: normalizedEmail,
            role,
        });
        if (useTasks) body.set("tasks", JSON.stringify([role, ...(financePermission ? [financePermission] : [])]));
        else if (financePermission) body.set("finance_permission", String(financePermission));

        return this.#request(`/${id}/business_users`, {}, {
            method: "post",
            data: body,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_BUSINESS_INVITE_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta надіслала запрошення до Business Manager",
        });
    }


    /** Призначає користувачу перелік задач для сторінки або рекламного акаунта. */
    async assignBusinessUserToAsset({ assetId, userId, tasks, businessId } = {}) {
        const asset = String(assetId ?? "").trim();
        const user = String(userId ?? "").trim();
        if (!/^\d+$/.test(asset.replace(/^act_/, "")) || !/^\d+$/.test(user)) {
            throw new Error("Некоректний ID активу або користувача Business Manager");
        }
        if (!Array.isArray(tasks) || tasks.some((task) => !String(task ?? "").trim())) {
            throw new Error("Не задано задачі доступу до активу");
        }

        const body = new URLSearchParams({
            user,
            tasks: JSON.stringify(tasks),
        });
        const normalizedBusinessId = String(businessId ?? "").trim();
        if (normalizedBusinessId) body.set("business", normalizedBusinessId);

        return this.#request(`/${asset}/assigned_users`, {}, {
            method: "post",
            data: body,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            retryOnConnectionError: false,
            outcomeUnknownCode: "FACEBOOK_BUSINESS_ASSET_ASSIGNMENT_OUTCOME_UNKNOWN",
            outcomeUnknownMessage: "Не вдалося визначити, чи Meta призначила користувачу доступ до активу",
        });
    }


    /** Перевіряє, чи існує активне або очікуване запрошення з указаною адресою. */
    async getBusinessUserInviteStatus(businessId, email) {
        const id = String(businessId ?? "").trim();
        const normalizedEmail = String(email ?? "").trim().toLowerCase();
        if (!/^\d+$/.test(id) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            throw new Error("Некоректний ID Business Manager або email користувача");
        }

        const [users, pendingUsers] = await Promise.all([
            this.#getAll(`/${id}/business_users`, {
                fields: "id,email,pending_email,role,finance_permission,tasks",
                limit: 100,
            }),
            this.#getAll(`/${id}/pending_users`, { limit: 100 }),
        ]);
        const matches = (items) => items.filter((item) => (
            [item.email, item.pending_email]
                .some((value) => String(value ?? "").trim().toLowerCase() === normalizedEmail)
        ));

        return {
            users: matches(users),
            pendingUsers: matches(pendingUsers),
        };
    }


    /** Читає роль і фінансовий рівень доступу користувача Business Manager. */
    async getBusinessUserDetails(userId) {
        const id = String(userId ?? "").trim();
        if (!/^\d+$/.test(id)) {
            throw new Error("Некоректний ID користувача Business Manager");
        }

        return this.#request(`/${id}`, {
            fields: "id,email,role,finance_permission,tasks",
        });
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
     * Повертає активні, призупинені, видалені та остаточно видалені кампанії рекламного акаунта.
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
                value: ["ACTIVE", "PAUSED", "DELETED", "ARCHIVED"],
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
            fields: "campaign_id,campaign_name,spend,impressions,clicks,ctr,actions",
            level: "campaign",
            date_preset: normalizedPreset,
            limit: 100,
        });

        return insights.map((insight) => ({
            campaignId: insight.campaign_id,
            campaignName: insight.campaign_name ?? null,
            spend: insight.spend ?? "0",
            impressions: insight.impressions ?? "0",
            clicks: insight.clicks ?? "0",
            ctr: insight.ctr ?? "0",
            actions: Array.isArray(insight.actions) ? insight.actions : [],
        }));
    }


    /** Змінює стан кампанії на ACTIVE, PAUSED або DELETED. */
    async setAdCampaignStatus(campaignId, status) {
        const id = normalizeObjectId(
            campaignId,
            "CAMPAIGN_ID_INVALID",
            "ID кампанії"
        );
        const normalizedStatus = String(status ?? "").trim().toUpperCase();
        if (!new Set(["ACTIVE", "PAUSED", "DELETED"]).has(normalizedStatus)) {
            throw createValidationError(
                "Статус кампанії має бути ACTIVE, PAUSED або DELETED",
                "CAMPAIGN_STATUS_INVALID"
            );
        }
        await this.#writeObject(`/${id}`, { status: normalizedStatus });
        return { id, status: normalizedStatus };
    }


    /** Змінює назву рекламної кампанії Meta. */
    async renameAdCampaign(campaignId, name) {
        const id = normalizeObjectId(
            campaignId,
            "CAMPAIGN_ID_INVALID",
            "ID кампанії"
        );
        const normalizedName = String(name ?? "").trim();
        if (!normalizedName) {
            throw createValidationError(
                "Вкажіть назву кампанії",
                "CAMPAIGN_NAME_REQUIRED"
            );
        }
        await this.#writeObject(`/${id}`, { name: normalizedName });
        return { id, name: normalizedName };
    }


    /** Позначає кампанію як видалену без незворотного HTTP DELETE. */
    async deleteAdCampaign(campaignId) {
        const id = normalizeObjectId(
            campaignId,
            "CAMPAIGN_ID_INVALID",
            "ID кампанії"
        );
        await this.setAdCampaignStatus(id, "DELETED");
        return { id, status: "DELETED", effectiveStatus: "DELETED" };
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


    async preflightLeadCampaign(options) {
        return preflightLeadCampaignWorkflow(options, {
            getPermissions: () => this.getPermissions(),
            getAccount: (id) => this.#request(`/${id}`, {
                fields: [
                    "id", "name", "account_status", "currency", "timezone_name",
                    "default_dsa_beneficiary", "default_dsa_payor",
                ].join(","),
            }),
            getPage: (id) => this.#getCampaignPage(id),
            getPost: (id, accessToken) => this.#request(
                `/${id}`, { fields: campaignPostFields }, { accessToken }
            ),
            getPixels: (id) => this.#getAll(
                `/${id}/adspixels`, { fields: "id,name", limit: 100 }
            ),
            getInstagramAccount: (id, accessToken) => this.#request(`/${id}`, {
                fields: "instagram_business_account{id,username}",
            }, { accessToken }),
            validateCampaign: (id, fields) => this.#writeObject(
                `/${id}/campaigns`, fields, { validateOnly: true }
            ),
        });
    }


    async createLeadCampaign(options, onProgress = () => {}) {
        return createLeadCampaignWorkflow(options, onProgress, {
            preflight: (input) => this.preflightLeadCampaign(input),
            createCampaign: (id, fields) => this.#writeObject(
                `/${id}/campaigns`, fields
            ),
            createCreative: (id, fields, settings) => this.#writeObject(
                `/${id}/adcreatives`, fields, settings
            ),
            createAdSet: (id, fields, settings) => this.#writeObject(
                `/${id}/adsets`, fields, settings
            ),
            createAd: (id, fields, settings) => this.#writeObject(
                `/${id}/ads`, fields, settings
            ),
            uploadImage: (id, image) => this.#uploadAdImage(id, image),
            activate: (id) => this.#writeObject(`/${id}`, { status: "ACTIVE" }),
            readback: (objects) => this.#readCampaignObjects(objects),
        });
    }


    async #readCampaignObjects(objects) {
        const [campaignReadback, creativeReadback, adSetsReadback, adsReadback] = await Promise.all([
            this.#readObject(
                objects.campaignId,
                ["id", "name", "status", "effective_status"]
            ),
            this.#readObject(
                objects.creativeId,
                [
                    "id", "name", "degrees_of_freedom_spec",
                    "contextual_multi_ads",
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
        return { campaign: campaignReadback, creative: creativeReadback, adSets: adSetsReadback, ads: adsReadback };
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
