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
const nameEditorFriendlyName = "FXIMIdentityNameEditorDialogQuery";
const nameEditorDocId = "25587875590838912";


export const getNameChangeStatusStatuses = Object.freeze({
    NAME_RULES_FOUND: "NAME_RULES_FOUND",
    NAME_RULES_NOT_FOUND: "NAME_RULES_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


function normalizeName(defaultValue) {
    return {
        firstName: defaultValue?.firstname ?? null,
        middleName: defaultValue?.middlename ?? null,
        lastName: defaultValue?.lastname ?? null,
    };
}


// Перевіряє правила Accounts Center без жодної зміни імені профілю.
export default async function getNameChangeStatus({ page, commonPayload, timeout }) {
    const validationError = validateMutationInput(page, commonPayload);
    if (validationError) {
        return createResult(false, getNameChangeStatusStatuses.INVALID_INPUT, null, {
            error: validationError,
        });
    }

    try {
        const normalizedTimeout = normalizeTimeout(timeout);
        const profileId = String(commonPayload.__user);
        const body = buildMutationBody(commonPayload, {
            friendlyName: nameEditorFriendlyName,
            docId: nameEditorDocId,
            variables: {
                field: "NAME",
                identity_id: profileId,
                interface: "FB_WEB",
                platform: "FACEBOOK",
                scale: 1,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: nameEditorFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
            endpoint: accountsCenterGraphqlEndpoint,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, getNameChangeStatusStatuses.REQUEST_TIMEOUT, null, {
                stage: "GET_NAME_RULES",
            });
        }
        if (response.requestError) {
            return createResult(false, getNameChangeStatusStatuses.REQUEST_FAILED, null, {
                stage: "GET_NAME_RULES",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, getNameChangeStatusStatuses.HTTP_ERROR, null, {
                stage: "GET_NAME_RULES",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, getNameChangeStatusStatuses.PARSE_ERROR, null, {
                stage: "GET_NAME_RULES",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, getNameChangeStatusStatuses.GRAPHQL_ERROR, data, {
                stage: "GET_NAME_RULES",
                httpStatus: response.statusCode,
            });
        }

        const identity = data?.data?.fxim_identity_for_id;
        const nameRules = identity?.screen_rules?.name;
        if (!nameRules) {
            return createResult(false, getNameChangeStatusStatuses.NAME_RULES_NOT_FOUND, {
                userId: profileId,
                currentName: null,
                canChangeName: null,
                cooldownStatus: null,
                canRevertName: null,
                nameChangeAvailable: null,
            }, {
                httpStatus: response.statusCode,
            });
        }

        const canChangeName = nameRules?.legacy_name_data?.can_change_name ?? null;
        const cooldownStatus = nameRules?.cooldown_status ?? null;
        const canRevertName = nameRules?.legacy_name_data?.can_revert_name ?? null;

        return createResult(true, getNameChangeStatusStatuses.NAME_RULES_FOUND, {
            userId: identity?.canonical_id ?? profileId,
            currentName: normalizeName(nameRules?.default_value),
            canChangeName,
            cooldownStatus,
            canRevertName,
            nameChangeAvailable: canChangeName === true && cooldownStatus === false,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, getNameChangeStatusStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
