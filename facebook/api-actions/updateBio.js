import { postFacebookForm, parseFacebookJson } from "../api/browserRequest.js";
import { readFacebookRuntime } from "../api/runtime.js";
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
function validateInput({ page, runtimeContext, collectionToken, sectionToken, value }) {
    if (!page || typeof page.evaluate !== "function") {
        return "Не передано Puppeteer page";
    }

    if (!runtimeContext || typeof runtimeContext !== "object") {
        return "Не передано runtimeContext";
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
        (field) => runtimeContext[field] === undefined
            || runtimeContext[field] === null
    );

    if (missingField) {
        return `У runtimeContext відсутнє поле ${missingField}`;
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
    collectionToken,
    sectionToken,
    value,
    timeout = defaultTimeoutMs,
}) {
    const runtimeContext = await readFacebookRuntime(page, { surface: "facebook", timeout });
    const validationError = validateInput({
        page,
        runtimeContext,
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
            actor_id: runtimeContext.av,
            client_mutation_id: "1",
        },
        scale: 1,
        sectionToken,
    };

    // Усі параметри передаються у форматі application/x-www-form-urlencoded.
    const requestBody = new URLSearchParams({
        av: String(runtimeContext.av),
        __user: String(runtimeContext.__user),
        __a: String(runtimeContext.__a),
        fb_dtsg: String(runtimeContext.fb_dtsg),
        jazoest: String(runtimeContext.jazoest),
        lsd: String(runtimeContext.lsd),
        __comet_req: String(runtimeContext.__comet_req),
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
        const response = await postFacebookForm(page, {
            body: requestBody, friendlyName: bioFriendlyName, timeout: normalizedTimeout,
        });
        if (!response.requestError) {
            try { response.data = parseFacebookJson(response.body); }
            catch { response.data = response.body; }
        }

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
