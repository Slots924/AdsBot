const graphqlEndpoint = "/api/graphql/";
const bioFriendlyName = "ProfileCometBioFieldSaveMutation";
const bioDocId = "28830271826608945";
const bioSectionType = "DIRECTORY_BIO";
const defaultTimeoutMs = 30000;


export const updateBioStatuses = Object.freeze({
    UPDATED: "UPDATED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Формує стандартизований результат для workflow.
function createResult(success, status, data = null, extra = {}) {
    return {
        success,
        status,
        data,
        ...extra,
    };
}


// Перевіряє, що всі параметри, необхідні для Bio mutation, передані.
function validateInput({ page, commonPayload, collectionToken, sectionToken, value }) {
    if (!page || typeof page.evaluate !== "function") {
        return "Не передано Puppeteer page";
    }

    if (!commonPayload || typeof commonPayload !== "object") {
        return "Не передано commonPayload";
    }

    const requiredPayloadFields = [
        "av",
        "__user",
        "__a",
        "fb_dtsg",
        "jazoest",
        "lsd",
        "__comet_req",
    ];

    const missingField = requiredPayloadFields.find(
        (field) => commonPayload[field] === undefined
            || commonPayload[field] === null
    );

    if (missingField) {
        return `У commonPayload відсутнє поле ${missingField}`;
    }

    if (typeof collectionToken !== "string" || !collectionToken) {
        return "collectionToken має бути непорожнім рядком";
    }

    if (typeof sectionToken !== "string" || !sectionToken) {
        return "sectionToken має бути непорожнім рядком";
    }

    if (typeof value !== "string") {
        return "value має бути рядком";
    }

    return null;
}


// Оновлює Bio профілю через ProfileCometBioFieldSaveMutation.
export default async function updateBio({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    value,
    timeout = defaultTimeoutMs,
}) {
    const validationError = validateInput({
        page,
        commonPayload,
        collectionToken,
        sectionToken,
        value,
    });

    if (validationError) {
        return createResult(
            false,
            updateBioStatuses.INVALID_INPUT,
            null,
            { error: validationError }
        );
    }

    const normalizedTimeout = Number.isFinite(Number(timeout))
        ? Math.max(1, Number(timeout))
        : defaultTimeoutMs;

    // variables містить значення, специфічні саме для оновлення Bio.
    const variables = {
        collectionToken,
        input: {
            bio: value,
            profile_field_section_type: bioSectionType,
            actor_id: commonPayload.__user,
            client_mutation_id: "1",
        },
        scale: 1,
        sectionToken,
    };

    // Усі параметри передаються у форматі application/x-www-form-urlencoded.
    const requestBody = new URLSearchParams({
        av: String(commonPayload.av),
        __user: String(commonPayload.__user),
        __a: String(commonPayload.__a),
        fb_dtsg: String(commonPayload.fb_dtsg),
        jazoest: String(commonPayload.jazoest),
        lsd: String(commonPayload.lsd),
        __comet_req: String(commonPayload.__comet_req),
        fb_api_caller_class: "RelayModern",
        server_timestamps: "true",
        fb_api_req_friendly_name: bioFriendlyName,
        doc_id: bioDocId,
        profile_field_section_type: bioSectionType,
        client_mutation_id: "1",
        scale: "1",
        variables: JSON.stringify(variables),
    }).toString();

    try {
        // Запит виконується всередині Facebook-сторінки,
        // тому браузер автоматично використовує її cookies та сесію.
        const response = await page.evaluate(
            async ({ body, friendlyName, lsd, timeoutMs, endpoint }) => {
                const controller = new AbortController();
                const timeoutId = setTimeout(
                    () => controller.abort(),
                    timeoutMs
                );

                try {
                    const fetchResponse = await fetch(endpoint, {
                        method: "POST",
                        credentials: "include",
                        headers: {
                            "content-type": "application/x-www-form-urlencoded",
                            "x-fb-friendly-name": friendlyName,
                            "x-fb-lsd": lsd,
                        },
                        body,
                        signal: controller.signal,
                    });

                    const responseText = await fetchResponse.text();
                    let responseData = responseText;

                    try {
                        responseData = JSON.parse(responseText);
                    } catch {
                        // Якщо Facebook повернув не JSON, залишаємо raw-відповідь.
                    }

                    return {
                        ok: fetchResponse.ok,
                        statusCode: fetchResponse.status,
                        data: responseData,
                    };
                } catch (error) {
                    return {
                        requestError: error?.name === "AbortError"
                            ? "TIMEOUT"
                            : String(error?.message ?? error),
                    };
                } finally {
                    clearTimeout(timeoutId);
                }
            },
            {
                body: requestBody,
                friendlyName: bioFriendlyName,
                lsd: String(commonPayload.lsd),
                timeoutMs: normalizedTimeout,
                endpoint: graphqlEndpoint,
            }
        );

        if (response.requestError === "TIMEOUT") {
            return createResult(
                false,
                updateBioStatuses.REQUEST_TIMEOUT,
                null,
                { error: "Facebook GraphQL request перевищив timeout" }
            );
        }

        if (response.requestError) {
            return createResult(
                false,
                updateBioStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }

        if (!response.ok) {
            return createResult(
                false,
                updateBioStatuses.HTTP_ERROR,
                response.data,
                { httpStatus: response.statusCode }
            );
        }

        if (Array.isArray(response.data?.errors) && response.data.errors.length) {
            return createResult(
                false,
                updateBioStatuses.GRAPHQL_ERROR,
                response.data,
                {
                    httpStatus: response.statusCode,
                    error: response.data.errors
                        .map((item) => item?.message)
                        .filter(Boolean)
                        .join("; ") || "Facebook GraphQL повернув помилку",
                }
            );
        }

        return createResult(
            true,
            updateBioStatuses.UPDATED,
            response.data,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(
            false,
            updateBioStatuses.ERROR,
            null,
            { error: String(error?.message ?? error) }
        );
    }
}
