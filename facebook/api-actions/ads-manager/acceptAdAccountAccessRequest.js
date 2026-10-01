import changeAdAccountAccessRequest from "./changeAdAccountAccessRequest.js";


export const acceptAdAccountAccessRequestStatuses = Object.freeze({
    ACCEPTED: "ACCEPTED",
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


// Приймає pending-запит Business Manager на доступ до рекламного акаунта.
export default async function acceptAdAccountAccessRequest(options) {
    return changeAdAccountAccessRequest({
        ...options,
        operation: "0",
        completedStatus: acceptAdAccountAccessRequestStatuses.ACCEPTED,
    });
}
