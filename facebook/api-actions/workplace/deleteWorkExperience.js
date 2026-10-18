import { readFacebookRuntime } from "../../api/runtime.js";
import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../../api/browserRequest.js";
import {
    getWorkMutationValidationError,
    workExperienceRouteName,
} from "./workExperienceSave.js";


const friendlyName = "ProfileCometAboutFieldItemDeleteMutation";
const docId = "29360829573506007";


export const deleteWorkExperienceStatuses = Object.freeze({
    DELETED: "DELETED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Видаляє Work Experience за його ID, а не за ID компанії чи посади.
export default async function deleteWorkExperience({
    page,
    collectionToken,
    sectionToken,
    workExperienceID,
    navChain,
    timeout,
}) {
    const runtimeContext = await readFacebookRuntime(page, { surface: "facebook", timeout });
    const validationError = validateMutationInput(page, runtimeContext);
    const workValidationError = getWorkMutationValidationError(
        runtimeContext
    );
    if (
        validationError
        || workValidationError
        || !collectionToken
        || !sectionToken
        || !workExperienceID
    ) {
        return createResult(
            false,
            deleteWorkExperienceStatuses.INVALID_INPUT,
            null,
            {
                error: validationError
                    ?? workValidationError
                    ?? "Потрібні collectionToken, sectionToken і workExperienceID",
            }
        );
    }

    const variables = {
        collectionToken,
        input: {
            entid: String(workExperienceID),
            field_type: "work",
            actor_id: String(runtimeContext.__user),
            client_mutation_id: "2",
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
    if (typeof navChain === "string" && navChain.trim()) {
        variables.input.logging_data = {
            nav_chain: navChain.trim(),
        };
    }
    const body = buildMutationBody(runtimeContext, {
        friendlyName,
        docId,
        variables,
        extraParameters: {
            __spin_r: runtimeContext.__spin_r,
            __spin_b: runtimeContext.__spin_b,
            __spin_t: runtimeContext.__spin_t,
            __crn: workExperienceRouteName,
        },
    });

    try {
        const response = await postFacebookForm(page, {
            body,
            friendlyName,
            timeout: normalizeTimeout(timeout),
        });
        if (response.requestError === "TIMEOUT") {
            return createResult(false, deleteWorkExperienceStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(
                false,
                deleteWorkExperienceStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }
        if (!response.ok) {
            return createResult(
                false,
                deleteWorkExperienceStatuses.HTTP_ERROR,
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
                deleteWorkExperienceStatuses.PARSE_ERROR,
                null,
                { error: String(error?.message ?? error) }
            );
        }
        if (hasGraphqlErrors(data)) {
            return createResult(
                false,
                deleteWorkExperienceStatuses.GRAPHQL_ERROR,
                data,
                { httpStatus: response.statusCode }
            );
        }

        return createResult(true, deleteWorkExperienceStatuses.DELETED, data, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, deleteWorkExperienceStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
