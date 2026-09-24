import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "./common.js";
import {
    buildEducationSaveVariables,
    educationSaveDocId,
    educationSaveFriendlyName,
} from "./educationSave.js";


export const createEducationStatuses = Object.freeze({
    CREATED: "CREATED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Створює новий College, коли educationExperienceID ще не існує.
export default async function createEducation({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    schoolId,
    schoolName,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (validationError || !collectionToken || !sectionToken || !schoolId || !schoolName) {
        return createResult(false, createEducationStatuses.INVALID_INPUT, null, {
            error: validationError ?? "Потрібні collectionToken, sectionToken, schoolId і schoolName",
        });
    }

    const variables = buildEducationSaveVariables({
        commonPayload,
        collectionToken,
        sectionToken,
        schoolId,
        schoolName,
    });
    const body = buildMutationBody(commonPayload, {
        friendlyName: educationSaveFriendlyName,
        docId: educationSaveDocId,
        variables,
    });

    try {
        const response = await postFacebookForm(page, {
            body,
            friendlyName: educationSaveFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });
        if (response.requestError === "TIMEOUT") {
            return createResult(false, createEducationStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, createEducationStatuses.REQUEST_FAILED, null, { error: response.requestError });
        }
        if (!response.ok) {
            return createResult(false, createEducationStatuses.HTTP_ERROR, null, { httpStatus: response.statusCode });
        }

        let data;
        try { data = parseFacebookJson(response.body); } catch (error) {
            return createResult(false, createEducationStatuses.PARSE_ERROR, null, { error: String(error?.message ?? error) });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, createEducationStatuses.GRAPHQL_ERROR, data, { httpStatus: response.statusCode });
        }

        return createResult(true, createEducationStatuses.CREATED, data, { httpStatus: response.statusCode });
    } catch (error) {
        return createResult(false, createEducationStatuses.ERROR, null, { error: String(error?.message ?? error) });
    }
}
