import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "./common.js";


const friendlyName = "useProfileCometDirectoryTypeaheadDataSourceQuery";
const docId = "24875651438740839";


export const searchCollegeStatuses = Object.freeze({
    COLLEGES_FOUND: "COLLEGES_FOUND",
    COLLEGES_NOT_FOUND: "COLLEGES_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Шукає об'єкти typeahead із назвою, Facebook ID та значенням.
function collectCollegeOptions(value, options = [], seen = new Set()) {
    if (!value || typeof value !== "object") return options;

    if (Array.isArray(value)) {
        value.forEach((item) => collectCollegeOptions(item, options, seen));
        return options;
    }

    const title = typeof value.title === "string"
        ? value.title
        : value.title?.text;
    const schoolId = value.fbid;
    const schoolName = typeof value.value === "string" ? value.value : title;

    if (title && schoolId !== undefined && schoolName) {
        const key = `${schoolId}:${schoolName}`;
        if (!seen.has(key)) {
            seen.add(key);
            options.push({
                title,
                fbid: String(schoolId),
                value: schoolName,
            });
        }
    }

    Object.values(value).forEach((item) => {
        collectCollegeOptions(item, options, seen);
    });
    return options;
}


// Шукає College через Facebook typeahead.
export default async function searchCollege({
    page,
    commonPayload,
    query,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (validationError) {
        return createResult(false, searchCollegeStatuses.INVALID_INPUT, null, {
            error: validationError,
        });
    }

    if (typeof query !== "string" || !query.trim()) {
        return createResult(false, searchCollegeStatuses.INVALID_INPUT, null, {
            error: "query має бути непорожнім рядком",
        });
    }

    const variables = {
        search_category: "COLLEGE",
        query: query.trim(),
    };
    const body = buildMutationBody(commonPayload, {
        friendlyName,
        docId,
        variables,
    });

    try {
        const response = await postFacebookForm(page, {
            body,
            friendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, searchCollegeStatuses.REQUEST_TIMEOUT, null);
        }
        if (response.requestError) {
            return createResult(false, searchCollegeStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, searchCollegeStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, searchCollegeStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
            });
        }

        if (hasGraphqlErrors(data)) {
            return createResult(false, searchCollegeStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        const options = collectCollegeOptions(data);
        return createResult(
            true,
            options.length
                ? searchCollegeStatuses.COLLEGES_FOUND
                : searchCollegeStatuses.COLLEGES_NOT_FOUND,
            options,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(false, searchCollegeStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
