import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const accountsCenterGraphqlEndpoint = "https://accountscenter.facebook.com/api/graphql/";
const nameValidatorFriendlyName = "useFXIMNameValidatorQuery";
const nameValidatorDocId = "26692801570319630";


export const validateFacebookNameStatuses = Object.freeze({
    NAME_VALIDATED: "NAME_VALIDATED",
    VALIDATION_RESULT_NOT_FOUND: "VALIDATION_RESULT_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


function normalizeRequiredNamePart(value) {
    return String(value ?? "").trim();
}


function normalizeMiddleName(value) {
    return String(value ?? "").trim();
}


// Перевіряє нове ім'я в Accounts Center без жодної зміни даних профілю.
export default async function validateFacebookName({
    page,
    commonPayload,
    firstName,
    middleName = "",
    lastName,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const normalizedFirstName = normalizeRequiredNamePart(firstName);
    const normalizedMiddleName = normalizeMiddleName(middleName);
    const normalizedLastName = normalizeRequiredNamePart(lastName);

    if (validationError || !normalizedFirstName || !normalizedLastName) {
        return createResult(false, validateFacebookNameStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? "Потрібні непорожні firstName і lastName для валідації імені",
        });
    }

    try {
        const normalizedTimeout = normalizeTimeout(timeout);
        const profileId = String(commonPayload.__user);
        const requestedName = {
            firstName: normalizedFirstName,
            middleName: normalizedMiddleName,
            lastName: normalizedLastName,
        };
        const body = buildMutationBody(commonPayload, {
            friendlyName: nameValidatorFriendlyName,
            docId: nameValidatorDocId,
            variables: {
                identity_ids: [profileId],
                first_name: requestedName.firstName,
                last_name: requestedName.lastName,
                middle_name: requestedName.middleName,
                scale: 1,
                platform: "FACEBOOK",
            },
            extraParameters: {
                __crn: "comet.fx.accounts_center.name.editor",
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: nameValidatorFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
            endpoint: accountsCenterGraphqlEndpoint,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, validateFacebookNameStatuses.REQUEST_TIMEOUT, null, {
                stage: "VALIDATE_NAME",
            });
        }
        if (response.requestError) {
            return createResult(false, validateFacebookNameStatuses.REQUEST_FAILED, null, {
                stage: "VALIDATE_NAME",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, validateFacebookNameStatuses.HTTP_ERROR, null, {
                stage: "VALIDATE_NAME",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, validateFacebookNameStatuses.PARSE_ERROR, null, {
                stage: "VALIDATE_NAME",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, validateFacebookNameStatuses.GRAPHQL_ERROR, data, {
                stage: "VALIDATE_NAME",
                httpStatus: response.statusCode,
            });
        }

        const validation = data?.data?.fx_identity_management?.validate_name_v2;
        if (!validation) {
            return createResult(false, validateFacebookNameStatuses.VALIDATION_RESULT_NOT_FOUND, {
                userId: profileId,
                requestedName,
                isValid: null,
                errorMessage: null,
            }, {
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, validateFacebookNameStatuses.NAME_VALIDATED, {
            userId: profileId,
            requestedName,
            isValid: typeof validation.is_valid === "boolean"
                ? validation.is_valid
                : null,
            errorMessage: validation.error_message ?? null,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, validateFacebookNameStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
