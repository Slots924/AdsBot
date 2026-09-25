import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const friendlyName = "useProfileCometDirectoryTypeaheadDataSourceQuery";
const docId = "24875651438740839";


export const searchWorkplaceStatuses = Object.freeze({
    COMPANIES_FOUND: "COMPANIES_FOUND",
    COMPANIES_NOT_FOUND: "COMPANIES_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує опції компаній із точного шляху typeahead-відповіді Facebook.
function collectWorkplaceOptions(data) {
    const suggestions = data?.data?.viewer
        ?.profile_directory_typeahead_suggestions;

    if (!Array.isArray(suggestions)) return [];

    return suggestions.reduce((options, suggestion) => {
        const title = typeof suggestion?.title === "string"
            ? suggestion.title
            : suggestion?.title?.text;
        const companyId = suggestion?.fbid;
        const companyName = typeof suggestion?.value === "string"
            ? suggestion.value
            : title;

        if (!title || companyId === undefined || companyId === "-1" || !companyName) {
            return options;
        }

        options.push({
            title,
            fbid: String(companyId),
            value: companyName,
        });
        return options;
    }, []);
}


// Шукає компанії через Facebook typeahead; опція з fbid "-1" повертається у data.
export default async function searchWorkplace({
    page,
    commonPayload,
    query,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (validationError) {
        return createResult(false, searchWorkplaceStatuses.INVALID_INPUT, null, {
            error: validationError,
        });
    }

    if (typeof query !== "string" || !query.trim()) {
        return createResult(false, searchWorkplaceStatuses.INVALID_INPUT, null, {
            error: "query має бути непорожнім рядком",
        });
    }

    const variables = {
        search_category: "WORKPLACE",
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
            return createResult(false, searchWorkplaceStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(
                false,
                searchWorkplaceStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }
        if (!response.ok) {
            return createResult(
                false,
                searchWorkplaceStatuses.HTTP_ERROR,
                null,
                { httpStatus: response.statusCode }
            );
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(
                false,
                searchWorkplaceStatuses.PARSE_ERROR,
                null,
                { error: String(error?.message ?? error) }
            );
        }

        if (hasGraphqlErrors(data)) {
            return createResult(
                false,
                searchWorkplaceStatuses.GRAPHQL_ERROR,
                data,
                { httpStatus: response.statusCode }
            );
        }

        const options = collectWorkplaceOptions(data);
        return createResult(
            true,
            options.length
                ? searchWorkplaceStatuses.COMPANIES_FOUND
                : searchWorkplaceStatuses.COMPANIES_NOT_FOUND,
            options,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(false, searchWorkplaceStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
