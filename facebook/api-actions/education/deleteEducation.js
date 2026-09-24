import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "./common.js";


const friendlyName = "ProfileCometAboutFieldItemDeleteMutation";
const docId = "29360829573506007";


export const deleteEducationStatuses = Object.freeze({
    DELETED: "DELETED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Видаляє конкретний запис College за його EducationExperience ID.
export default async function deleteEducation({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    educationExperienceID,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (validationError || !collectionToken || !sectionToken || !educationExperienceID) {
        return createResult(false, deleteEducationStatuses.INVALID_INPUT, null, {
            error: validationError ?? "Потрібні collectionToken, sectionToken і educationExperienceID",
        });
    }

    // logging_data.nav_chain навмисно не передаємо: це зафіксовано як тимчасове правило.
    const variables = {
        collectionToken,
        input: {
            entid: String(educationExperienceID),
            field_type: "education",
            actor_id: String(commonPayload.__user),
            client_mutation_id: "1",
        },
        scale: 1,
        sectionToken,
        profileID: "0",
        isNicknameField: false,
        isNamePronunciationField: false,
        isProfileDirectory: true,
        isFamilyDeletion: false,
        __relay_internal__pv__ProfileCometFeaturedHighlightsPortraitAspectRatioGKrelayprovider: false,
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
            return createResult(false, deleteEducationStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, deleteEducationStatuses.REQUEST_FAILED, null, { error: response.requestError });
        }
        if (!response.ok) {
            return createResult(false, deleteEducationStatuses.HTTP_ERROR, null, { httpStatus: response.statusCode });
        }

        let data;
        try { data = parseFacebookJson(response.body); } catch (error) {
            return createResult(false, deleteEducationStatuses.PARSE_ERROR, null, { error: String(error?.message ?? error) });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, deleteEducationStatuses.GRAPHQL_ERROR, data, { httpStatus: response.statusCode });
        }

        return createResult(true, deleteEducationStatuses.DELETED, data, { httpStatus: response.statusCode });
    } catch (error) {
        return createResult(false, deleteEducationStatuses.ERROR, null, { error: String(error?.message ?? error) });
    }
}
