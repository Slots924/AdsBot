import getEducationExperiences
    from "./getEducationExperiences.js";
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


export const updateEducationStatuses = Object.freeze({
    UPDATED: "UPDATED",
    EDUCATION_NOT_FOUND: "EDUCATION_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Змінює конкретний існуючий College після перевірки його EducationExperience ID.
export default async function updateEducation({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    rawSectionToken,
    educationExperienceID,
    schoolId,
    schoolName,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (
        validationError
        || !collectionToken
        || !sectionToken
        || !rawSectionToken
        || !educationExperienceID
        || !schoolId
        || !schoolName
    ) {
        return createResult(false, updateEducationStatuses.INVALID_INPUT, null, {
            error: validationError ?? "Потрібні collectionToken, sectionToken, rawSectionToken, educationExperienceID, schoolId і schoolName",
        });
    }

    // Перед mutation перевіряємо, що цей ID справді належить College профілю.
    const currentEducation = await getEducationExperiences({
        page,
        commonPayload,
        collectionToken,
        sectionToken,
        rawSectionToken,
        timeout,
    });

    if (!currentEducation.success) {
        return createResult(false, currentEducation.status, currentEducation.data, {
            error: currentEducation.error,
            httpStatus: currentEducation.httpStatus,
        });
    }

    const exists = currentEducation.data.some(
        (item) => item.education_experience_id === String(educationExperienceID)
    );
    if (!exists) {
        return createResult(false, updateEducationStatuses.EDUCATION_NOT_FOUND, null, {
            error: `College з educationExperienceID ${educationExperienceID} не знайдено`,
        });
    }

    const variables = buildEducationSaveVariables({
        commonPayload,
        collectionToken,
        sectionToken,
        schoolId,
        schoolName,
        educationExperienceID,
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
            return createResult(false, updateEducationStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, updateEducationStatuses.REQUEST_FAILED, null, { error: response.requestError });
        }
        if (!response.ok) {
            return createResult(false, updateEducationStatuses.HTTP_ERROR, null, { httpStatus: response.statusCode });
        }

        let data;
        try { data = parseFacebookJson(response.body); } catch (error) {
            return createResult(false, updateEducationStatuses.PARSE_ERROR, null, { error: String(error?.message ?? error) });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, updateEducationStatuses.GRAPHQL_ERROR, data, { httpStatus: response.statusCode });
        }

        return createResult(true, updateEducationStatuses.UPDATED, data, { httpStatus: response.statusCode });
    } catch (error) {
        return createResult(false, updateEducationStatuses.ERROR, null, { error: String(error?.message ?? error) });
    }
}
