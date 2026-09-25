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


export const searchJobTitleStatuses = Object.freeze({
    JOB_TITLES_FOUND: "JOB_TITLES_FOUND",
    JOB_TITLES_NOT_FOUND: "JOB_TITLES_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує реальні посади з точного шляху typeahead-відповіді Facebook.
function collectJobTitleOptions(data) {
    const suggestions = data?.data?.viewer
        ?.profile_directory_typeahead_suggestions;

    if (!Array.isArray(suggestions)) return [];

    return suggestions.reduce((options, suggestion) => {
        const title = typeof suggestion?.title === "string"
            ? suggestion.title
            : suggestion?.title?.text;
        const jobTitleId = suggestion?.fbid;
        const jobTitleName = typeof suggestion?.value === "string"
            ? suggestion.value
            : title;

        if (!title || jobTitleId === undefined || jobTitleId === "-1"
            || !jobTitleName) {
            return options;
        }

        options.push({
            title,
            fbid: String(jobTitleId),
            value: jobTitleName,
        });
        return options;
    }, []);
}


// Шукає наявні Facebook-посади через typeahead.
export default async function searchJobTitle({
    page,
    commonPayload,
    query,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (validationError) {
        return createResult(false, searchJobTitleStatuses.INVALID_INPUT, null, {
            error: validationError,
        });
    }

    if (typeof query !== "string" || !query.trim()) {
        return createResult(false, searchJobTitleStatuses.INVALID_INPUT, null, {
            error: "query має бути непорожнім рядком",
        });
    }

    const variables = {
        search_category: "JOB_TITLE",
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
            return createResult(false, searchJobTitleStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(
                false,
                searchJobTitleStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }
        if (!response.ok) {
            return createResult(
                false,
                searchJobTitleStatuses.HTTP_ERROR,
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
                searchJobTitleStatuses.PARSE_ERROR,
                null,
                { error: String(error?.message ?? error) }
            );
        }

        if (hasGraphqlErrors(data)) {
            return createResult(
                false,
                searchJobTitleStatuses.GRAPHQL_ERROR,
                data,
                { httpStatus: response.statusCode }
            );
        }

        const options = collectJobTitleOptions(data);
        return createResult(
            true,
            options.length
                ? searchJobTitleStatuses.JOB_TITLES_FOUND
                : searchJobTitleStatuses.JOB_TITLES_NOT_FOUND,
            options,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(false, searchJobTitleStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
