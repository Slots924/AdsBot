import {
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
} from "../education/common.js";


const friendlyName = "BizKitSettingsRequestAdAccountAccessMutation";
const docId = "23962130140039997";
const defaultBusinessId = "703191138787237";
export const fullAdAccountTaskIds = Object.freeze([
    "864195700451909",
    "151821535410699",
    "610690166001223",
    "186595505260379",
]);


export const requestAdAccountAccessStatuses = Object.freeze({
    PENDING: "PENDING",
    PENDING_REQUEST_LIMIT: "PENDING_REQUEST_LIMIT",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    ACCESS_STATUS_UNEXPECTED: "ACCESS_STATUS_UNEXPECTED",
    INVALID_INPUT: "INVALID_INPUT",
    RUNTIME_DATA_UNAVAILABLE: "RUNTIME_DATA_UNAVAILABLE",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    REQUEST_FAILED: "REQUEST_FAILED",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    ERROR: "ERROR",
});


// Надсилає з поточної Business Manager-сесії запит на повний доступ до рекламного акаунта.
export default async function requestAdAccountAccess({
    page,
    adAccountId,
    businessId = defaultBusinessId,
    timeout,
}) {
    const accountId = String(adAccountId ?? "").trim().replace(/^act_/, "");
    const requestingBusinessId = String(businessId ?? "").trim();
    const pageUrl = typeof page?.url === "function" ? page.url() : "";
    let hostname = "";
    try {
        hostname = new URL(pageUrl).hostname;
    } catch {
        // Порожній або некоректний URL обробляється як невалідний контекст.
    }

    if (typeof page?.evaluate !== "function" || hostname !== "business.facebook.com"
        || !/^\d+$/.test(accountId) || !/^\d+$/.test(requestingBusinessId)) {
        return createResult(false, requestAdAccountAccessStatuses.INVALID_INPUT, null, {
            error: "Потрібні Puppeteer page на business.facebook.com, числові adAccountId і businessId",
        });
    }

    try {
        // Зчитує одноразові значення лише з активної Facebook-сторінки.
        const runtime = await page.evaluate(() => {
            try {
                const actorId = String(require("CurrentUserInitialData").USER_ID ?? "");
                const fbDtsg = String(require("DTSGInitialData").token ?? "");
                const lsd = String(require("LSD").token ?? "");
                return { actorId, fbDtsg, lsd };
            } catch {
                return null;
            }
        });
        if (!/^\d+$/.test(runtime?.actorId ?? "") || !runtime?.fbDtsg || !runtime?.lsd) {
            return createResult(false, requestAdAccountAccessStatuses.RUNTIME_DATA_UNAVAILABLE);
        }

        const jazoest = `2${[...runtime.fbDtsg].reduce((sum, character) =>
            sum + character.charCodeAt(0), 0)}`;
        const body = new URLSearchParams({
            av: runtime.actorId,
            __user: runtime.actorId,
            __a: "1",
            __bid: requestingBusinessId,
            fb_dtsg: runtime.fbDtsg,
            jazoest,
            lsd: runtime.lsd,
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: friendlyName,
            server_timestamps: "true",
            variables: JSON.stringify({
                input: {
                    actor_id: runtime.actorId,
                    client_mutation_id: "3",
                    ad_account_id: accountId,
                    permitted_roles: fullAdAccountTaskIds,
                    permitted_tasks: [],
                    requesting_business_id: requestingBusinessId,
                },
            }),
            doc_id: docId,
        }).toString();
        const response = await postFacebookForm(page, {
            body,
            friendlyName,
            lsd: runtime.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response?.requestError === "TIMEOUT") {
            return createResult(false, requestAdAccountAccessStatuses.REQUEST_TIMEOUT);
        }
        if (response?.requestError) {
            return createResult(false, requestAdAccountAccessStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }

        let payload;
        try {
            payload = parseFacebookJson(response?.body);
        } catch {
            return createResult(false, requestAdAccountAccessStatuses.PARSE_ERROR, null, {
                httpStatus: response?.statusCode ?? null,
            });
        }

        if (hasGraphqlErrors(payload)) {
            const graphErrors = payload.errors.map((item) => ({
                code: item?.code ?? null,
                apiErrorCode: item?.api_error_code ?? null,
                summary: item?.summary ?? null,
                description: item?.description ?? null,
                fbtraceId: item?.fbtrace_id ?? null,
            }));
            const limitReached = graphErrors.some((item) => Number(item.code) === 1752207);
            return createResult(false, limitReached
                ? requestAdAccountAccessStatuses.PENDING_REQUEST_LIMIT
                : requestAdAccountAccessStatuses.GRAPHQL_ERROR, null, {
                httpStatus: response?.statusCode ?? null,
                graphErrors,
            });
        }
        if (!response?.ok) {
            return createResult(false, requestAdAccountAccessStatuses.HTTP_ERROR, null, {
                httpStatus: response?.statusCode ?? null,
            });
        }

        const access = payload?.data?.business_settings_request_ad_account_access;
        if (access?.access_status !== "PENDING") {
            return createResult(false, requestAdAccountAccessStatuses.ACCESS_STATUS_UNEXPECTED, {
                accessStatus: access?.access_status ?? null,
                admarketId: access?.admarket_id ?? null,
            }, { httpStatus: response.statusCode });
        }

        return createResult(true, requestAdAccountAccessStatuses.PENDING, {
            adAccountId: accountId,
            businessId: requestingBusinessId,
            accessStatus: access.access_status,
            admarketId: access.admarket_id ?? null,
            adMarketId: access.admarket_id ?? null,
        }, { httpStatus: response.statusCode });
    } catch (error) {
        return createResult(false, requestAdAccountAccessStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
