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
    buildWorkExperienceSaveVariables,
    getWorkMutationValidationError,
    workExperienceRouteName,
    workExperienceSaveDocId,
    workExperienceSaveFriendlyName,
} from "./workExperienceSave.js";


export const createWorkExperienceStatuses = Object.freeze({
    CREATED: "CREATED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Створює Work Experience з існуючою компанією та існуючою Facebook-посадою.
export default async function createWorkExperience({
    page,
    collectionToken,
    sectionToken,
    companyId,
    companyName = null,
    jobTitleId,
    jobTitleName = null,
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
        || !companyId
        || !jobTitleId
    ) {
        return createResult(
            false,
            createWorkExperienceStatuses.INVALID_INPUT,
            null,
            {
                error: validationError
                    ?? workValidationError
                    ?? "Потрібні collectionToken, sectionToken, companyId і jobTitleId",
            }
        );
    }

    const variables = buildWorkExperienceSaveVariables({
        runtimeContext,
        collectionToken,
        sectionToken,
        companyId,
        companyName,
        jobTitleId,
        jobTitleName,
        navChain,
    });
    const body = buildMutationBody(runtimeContext, {
        friendlyName: workExperienceSaveFriendlyName,
        docId: workExperienceSaveDocId,
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
            friendlyName: workExperienceSaveFriendlyName,
            timeout: normalizeTimeout(timeout),
        });
        if (response.requestError === "TIMEOUT") {
            return createResult(false, createWorkExperienceStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(
                false,
                createWorkExperienceStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }
        if (!response.ok) {
            return createResult(
                false,
                createWorkExperienceStatuses.HTTP_ERROR,
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
                createWorkExperienceStatuses.PARSE_ERROR,
                null,
                { error: String(error?.message ?? error) }
            );
        }
        if (hasGraphqlErrors(data)) {
            return createResult(
                false,
                createWorkExperienceStatuses.GRAPHQL_ERROR,
                data,
                { httpStatus: response.statusCode }
            );
        }

        return createResult(true, createWorkExperienceStatuses.CREATED, data, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, createWorkExperienceStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
