import { randomUUID } from "node:crypto";

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
const updateNameFriendlyName = "useFXIMUpdateNameMutation";
const updateNameDocId = "9538143859625836";
const familyDeviceId = "device_id_fetch_datr";


export const changeFacebookNameStatuses = Object.freeze({
    NAME_CHANGED: "NAME_CHANGED",
    NAME_CHANGE_REJECTED: "NAME_CHANGE_REJECTED",
    UPDATE_RESULT_NOT_FOUND: "UPDATE_RESULT_NOT_FOUND",
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


function normalizeConfirmation(updateResult) {
    const legacyNameData = updateResult?.legacy_name_data ?? {};

    return {
        canChangeName: legacyNameData.can_change_name ?? null,
        canRevertName: legacyNameData.can_revert_name ?? null,
        previousNameFull: legacyNameData.previous_name_full ?? null,
        previousNameFirst: legacyNameData.previous_name_first ?? null,
        previousNameMiddle: legacyNameData.previous_name_middle ?? null,
        previousNameLast: legacyNameData.previous_name_last ?? null,
        cooldownStatus: updateResult?.cooldown_status ?? null,
        lastNameChangedText: updateResult?.last_name_changed_text ?? null,
    };
}


// Змінює ім'я поточного профілю через Accounts Center після окремої перевірки правил імені.
export default async function changeFacebookName({
    page,
    commonPayload,
    firstName,
    middleName = "",
    lastName,
    clientMutationId = randomUUID(),
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const normalizedFirstName = normalizeRequiredNamePart(firstName);
    const normalizedMiddleName = normalizeMiddleName(middleName);
    const normalizedLastName = normalizeRequiredNamePart(lastName);
    const normalizedClientMutationId = String(clientMutationId ?? "").trim();

    if (
        validationError
        || !normalizedFirstName
        || !normalizedLastName
        || !normalizedClientMutationId
    ) {
        return createResult(false, changeFacebookNameStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (!normalizedFirstName || !normalizedLastName
                    ? "Потрібні непорожні firstName і lastName для зміни імені"
                    : "Потрібен clientMutationId"),
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
        const fullName = [
            requestedName.firstName,
            requestedName.middleName,
            requestedName.lastName,
        ].filter(Boolean).join(" ");
        const body = buildMutationBody(commonPayload, {
            friendlyName: updateNameFriendlyName,
            docId: updateNameDocId,
            variables: {
                client_mutation_id: normalizedClientMutationId,
                family_device_id: familyDeviceId,
                identity_ids: [profileId],
                full_name: fullName,
                first_name: requestedName.firstName,
                middle_name: requestedName.middleName,
                last_name: requestedName.lastName,
                interface: "FB_WEB",
            },
            extraParameters: {
                __crn: "comet.fx.accounts_center.name.editor",
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: updateNameFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
            endpoint: accountsCenterGraphqlEndpoint,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, changeFacebookNameStatuses.REQUEST_TIMEOUT, null, {
                stage: "CHANGE_NAME",
            });
        }
        if (response.requestError) {
            return createResult(false, changeFacebookNameStatuses.REQUEST_FAILED, null, {
                stage: "CHANGE_NAME",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, changeFacebookNameStatuses.HTTP_ERROR, null, {
                stage: "CHANGE_NAME",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, changeFacebookNameStatuses.PARSE_ERROR, null, {
                stage: "CHANGE_NAME",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, changeFacebookNameStatuses.GRAPHQL_ERROR, data, {
                stage: "CHANGE_NAME",
                httpStatus: response.statusCode,
            });
        }

        const updateResult = data?.data?.fxim_update_identity_name;
        if (!updateResult) {
            return createResult(false, changeFacebookNameStatuses.UPDATE_RESULT_NOT_FOUND, {
                userId: profileId,
                requestedName,
                error: null,
                confirmation: null,
            }, {
                httpStatus: response.statusCode,
            });
        }

        const resultData = {
            userId: profileId,
            requestedName,
            error: updateResult.error ?? null,
            confirmation: normalizeConfirmation(updateResult),
        };
        if (updateResult.error !== null && updateResult.error !== undefined) {
            return createResult(false, changeFacebookNameStatuses.NAME_CHANGE_REJECTED, resultData, {
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, changeFacebookNameStatuses.NAME_CHANGED, resultData, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, changeFacebookNameStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
