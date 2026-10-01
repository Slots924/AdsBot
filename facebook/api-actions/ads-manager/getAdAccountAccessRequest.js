import { createResult } from "../education/common.js";
import {
    getAgencyResponseError,
    parseAgencyDialog,
    performAgencyRequest,
    validateAgencyRequestInput,
} from "./agencyAccessRequestCommon.js";


export const getAdAccountAccessRequestStatuses = Object.freeze({
    FOUND: "FOUND",
    NOT_FOUND: "NOT_FOUND",
    DIALOG_INCOMPLETE: "DIALOG_INCOMPLETE",
    INVALID_INPUT: "INVALID_INPUT",
    RUNTIME_DATA_UNAVAILABLE: "RUNTIME_DATA_UNAVAILABLE",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    REQUEST_FAILED: "REQUEST_FAILED",
    HTTP_ERROR: "HTTP_ERROR",
    FACEBOOK_ERROR: "FACEBOOK_ERROR",
    ERROR: "ERROR",
});


// Перевіряє конкретний pending-запит за adMarketId і повертає його актуальні дії.
export default async function getAdAccountAccessRequest({
    page,
    adAccountId,
    agencyId,
    adMarketId,
    timeout,
}) {
    const input = validateAgencyRequestInput(page, adAccountId, agencyId, adMarketId);
    if (input.error) {
        return createResult(false, getAdAccountAccessRequestStatuses.INVALID_INPUT, null, {
            error: input.error,
        });
    }

    try {
        const response = await performAgencyRequest(page, { method: "GET", ...input, timeout });
        if (response?.runtimeUnavailable) {
            return createResult(false, getAdAccountAccessRequestStatuses.RUNTIME_DATA_UNAVAILABLE);
        }
        if (response?.requestError === "TIMEOUT") {
            return createResult(false, getAdAccountAccessRequestStatuses.REQUEST_TIMEOUT);
        }
        if (response?.requestError) {
            return createResult(false, getAdAccountAccessRequestStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response?.ok) {
            return createResult(false, getAdAccountAccessRequestStatuses.HTTP_ERROR, null, {
                httpStatus: response?.statusCode ?? null,
            });
        }
        const facebookError = getAgencyResponseError(response.body);
        if (facebookError) {
            return createResult(false, getAdAccountAccessRequestStatuses.FACEBOOK_ERROR, null, {
                httpStatus: response.statusCode,
                facebookError,
            });
        }

        const invite = parseAgencyDialog(response.body, input);
        if (!invite) {
            return createResult(true, getAdAccountAccessRequestStatuses.NOT_FOUND, null, {
                httpStatus: response.statusCode,
            });
        }
        if (!invite.accept || !invite.reject) {
            return createResult(false, getAdAccountAccessRequestStatuses.DIALOG_INCOMPLETE, null, {
                httpStatus: response.statusCode,
            });
        }
        return createResult(true, getAdAccountAccessRequestStatuses.FOUND, invite, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, getAdAccountAccessRequestStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
