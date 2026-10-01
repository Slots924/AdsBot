import changeAdAccountAccessRequest from "./changeAdAccountAccessRequest.js";


export const rejectAdAccountAccessRequestStatuses = Object.freeze({
    REJECTED: "REJECTED",
    RESULT_UNCONFIRMED: "RESULT_UNCONFIRMED",
    INVALID_INPUT: "INVALID_INPUT",
    RUNTIME_DATA_UNAVAILABLE: "RUNTIME_DATA_UNAVAILABLE",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    REQUEST_FAILED: "REQUEST_FAILED",
    HTTP_ERROR: "HTTP_ERROR",
    FACEBOOK_ERROR: "FACEBOOK_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    ERROR: "ERROR",
});


// Відхиляє pending-запит Business Manager на доступ до рекламного акаунта.
export default async function rejectAdAccountAccessRequest(options) {
    return changeAdAccountAccessRequest({
        ...options,
        operation: "1",
        completedStatus: rejectAdAccountAccessRequestStatuses.REJECTED,
    });
}
