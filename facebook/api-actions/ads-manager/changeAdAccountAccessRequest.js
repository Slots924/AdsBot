import { createResult, parseFacebookJson } from "../education/common.js";
import {
    getAgencyResponseError,
    performAgencyRequest,
    validateAgencyRequestInput,
} from "./agencyAccessRequestCommon.js";


// Виконує лише POST із даними, які окремий detect action повернув для конкретного запиту.
export default async function changeAdAccountAccessRequest({
    page,
    invite,
    operation,
    completedStatus,
    timeout,
}) {
    const input = validateAgencyRequestInput(
        page, invite?.adAccountId, invite?.agencyId, invite?.adMarketId
    );
    const action = operation === "0" ? invite?.accept : invite?.reject;
    if (input.error || !/^\d+$/.test(String(action?.ext ?? ""))
        || !/^[A-Za-z0-9_-]+$/.test(String(action?.hash ?? ""))) {
        return createResult(false, "INVALID_INPUT", null, {
            error: input.error ?? "Потрібні ext і hash відповідної дії з результату getAdAccountAccessRequest",
        });
    }

    try {
        const response = await performAgencyRequest(page, {
            method: "POST",
            ...input,
            operation,
            ext: action.ext,
            hash: action.hash,
            timeout,
        });
        if (response?.runtimeUnavailable) {
            return createResult(false, "RUNTIME_DATA_UNAVAILABLE");
        }
        if (response?.requestError === "TIMEOUT") {
            return createResult(false, "REQUEST_TIMEOUT");
        }
        if (response?.requestError) {
            return createResult(false, "REQUEST_FAILED", null, { error: response.requestError });
        }
        if (!response?.ok) {
            return createResult(false, "HTTP_ERROR", null, {
                httpStatus: response?.statusCode ?? null,
            });
        }
        const facebookError = getAgencyResponseError(response.body);
        if (facebookError) {
            return createResult(false, "FACEBOOK_ERROR", null, {
                httpStatus: response.statusCode,
                facebookError,
            });
        }
        let payload;
        try {
            payload = parseFacebookJson(response.body);
        } catch {
            return createResult(false, "PARSE_ERROR", null, {
                httpStatus: response.statusCode,
            });
        }
        if (payload?.__ar !== 1 && payload?.__ar !== true) {
            return createResult(false, "RESULT_UNCONFIRMED", null, {
                httpStatus: response.statusCode,
            });
        }
        return createResult(true, completedStatus, {
            ...input,
        }, { httpStatus: response.statusCode });
    } catch (error) {
        return createResult(false, "ERROR", null, {
            error: String(error?.message ?? error),
        });
    }
}
