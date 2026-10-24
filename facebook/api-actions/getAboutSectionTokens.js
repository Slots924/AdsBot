import { postFacebookForm } from "../api/browserRequest.js";
import { readFacebookRuntime } from "../api/runtime.js";
import { isFacebookApiContext } from "../api/actionTransport.js";
const endpoint = "/ajax/bulk-route-definitions/";
const routingNamespace = "fb_comet";
const routeName = "comet.fbweb.CometProfileAboutTabRoute";
const defaultTimeoutMs = 30000;


export const getAboutSectionTokensStatuses = Object.freeze({
    TOKENS_FETCHED: "TOKENS_FETCHED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    TOKENS_NOT_FOUND: "TOKENS_NOT_FOUND",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Формує однаковий формат результату для всіх варіантів завершення action.
function createResult(success, status, data = null, extra = {}) {
    return {
        success,
        status,
        data,
        ...extra,
    };
}


// Перевіряє, що action отримав сторінку, runtimeContext і список секцій.
function validateInput({ page, runtimeContext, sections }) {
    if (!isFacebookApiContext(page)) {
        return "Не передано Puppeteer page";
    }

    if (!runtimeContext || typeof runtimeContext !== "object") {
        return "Не передано runtimeContext";
    }

    const requiredPayloadFields = [
        "__user",
        "__a",
        "__comet_req",
        "fb_dtsg",
        "jazoest",
        "lsd",
        "__rev",
        "__spin_r",
        "__spin_b",
        "__spin_t",
    ];

    const missingField = requiredPayloadFields.find(
        (field) => runtimeContext[field] === undefined
            || runtimeContext[field] === null
    );

    if (missingField) {
        return `У runtimeContext відсутнє поле ${missingField}`;
    }

    if (!Array.isArray(sections) || sections.length === 0) {
        return "sections має бути непорожнім масивом";
    }

    if (sections.some((section) => typeof section !== "string" || !section)) {
        return "Кожна секція в sections має бути непорожнім рядком";
    }

    return null;
}


// Видаляє службовий префікс Facebook перед JSON-відповіддю.
function parseFacebookResponse(rawResponse) {
    const cleanedResponse = String(rawResponse ?? "")
        .replace(/^for\s*\(\s*;;\s*\);\s*/, "");

    return JSON.parse(cleanedResponse);
}


// Дістає токени конкретної секції з rootView.props.
function extractSectionTokens(responseData, routeUrl) {
    const props = responseData?.payload?.payloads?.[routeUrl]
        ?.result?.exports?.rootView?.props;

    if (!props?.collectionToken || !props?.sectionToken) {
        return null;
    }

    return {
        collectionToken: props.collectionToken,
        sectionToken: props.sectionToken,
        rawSectionToken: props.rawSectionToken ?? null,
    };
}


// Отримує токени для секцій вкладки About через bulk-route-definitions.
export default async function getAboutSectionTokens({
    page,
    sections,
    timeout = defaultTimeoutMs,
}) {
    const runtimeContext = await readFacebookRuntime(page, { surface: "facebook", timeout });
    const validationError = validateInput({
        page,
        runtimeContext,
        sections,
    });

    if (validationError) {
        return createResult(
            false,
            getAboutSectionTokensStatuses.INVALID_INPUT,
            null,
            { error: validationError }
        );
    }

    const normalizedTimeout = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;

    const routeUrls = sections.map(
        (section) => `/profile.php?id=${runtimeContext.av}&sk=${section}`
    );

    // Формуємо мінімальний перевірений form-urlencoded body.
    const requestParams = new URLSearchParams({
        __user: String(runtimeContext.__user),
        __a: String(runtimeContext.__a),
        __comet_req: String(runtimeContext.__comet_req),
        fb_dtsg: String(runtimeContext.fb_dtsg),
        jazoest: String(runtimeContext.jazoest),
        lsd: String(runtimeContext.lsd),
        __rev: String(runtimeContext.__rev),
        __spin_r: String(runtimeContext.__spin_r),
        __spin_b: String(runtimeContext.__spin_b),
        __spin_t: String(runtimeContext.__spin_t),
        routing_namespace: routingNamespace,
        __crn: routeName,
    });

    // Кожен route_url має бути окремим полем з індексом, а не JSON-масивом.
    routeUrls.forEach((routeUrl, index) => {
        requestParams.append(`route_urls[${index}]`, routeUrl);
    });

    try {
        // Запит виконується всередині Facebook-сторінки,
        // тому браузер використовує поточні cookies та авторизацію.
        const response = await postFacebookForm(page, {
            body: requestParams.toString(), endpoint, timeout: normalizedTimeout,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(
                false,
                getAboutSectionTokensStatuses.REQUEST_TIMEOUT,
                null,
                { error: "Facebook bulk route request перевищив timeout" }
            );
        }

        if (response.requestError) {
            return createResult(
                false,
                getAboutSectionTokensStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }

        if (!response.ok) {
            return createResult(
                false,
                getAboutSectionTokensStatuses.HTTP_ERROR,
                null,
                { httpStatus: response.statusCode }
            );
        }

        let responseData;
        try {
            responseData = parseFacebookResponse(response.body);
        } catch (error) {
            return createResult(
                false,
                getAboutSectionTokensStatuses.PARSE_ERROR,
                null,
                { error: String(error?.message ?? error) }
            );
        }

        const tokensBySection = {};
        const missingSections = [];

        sections.forEach((section, index) => {
            const tokens = extractSectionTokens(responseData, routeUrls[index]);

            if (!tokens) {
                missingSections.push(section);
                return;
            }

            tokensBySection[section] = tokens;
        });

        if (missingSections.length > 0) {
            return createResult(
                false,
                getAboutSectionTokensStatuses.TOKENS_NOT_FOUND,
                tokensBySection,
                { missingSections, httpStatus: response.statusCode }
            );
        }

        return createResult(
            true,
            getAboutSectionTokensStatuses.TOKENS_FETCHED,
            tokensBySection,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(
            false,
            getAboutSectionTokensStatuses.ERROR,
            null,
            { error: String(error?.message ?? error) }
        );
    }
}
