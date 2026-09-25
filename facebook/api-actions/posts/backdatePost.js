import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const backdateFriendlyName = "ProfileCometBackdateStoryMutation";
const backdateDocId = "9660071250706684";


export const backdatePostStatuses = Object.freeze({
    BACKDATED: "BACKDATED",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Перевіряє складові календарної дати без припущень про часовий пояс Facebook.
function normalizeBackdate({ year, month, day, hour, minute }) {
    const values = { year, month, day, hour, minute };
    const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key,
        Number(value),
    ]));

    if (!Object.values(normalized).every(Number.isInteger)) return null;
    if (normalized.year < 1 || normalized.month < 1 || normalized.month > 12) return null;
    if (normalized.hour < 0 || normalized.hour > 23) return null;
    if (normalized.minute < 0 || normalized.minute > 59) return null;

    const daysInMonth = new Date(
        Date.UTC(normalized.year, normalized.month, 0)
    ).getUTCDate();
    if (normalized.day < 1 || normalized.day > daysInMonth) return null;

    return normalized;
}


// Змінює дату й час існуючого поста поточного Facebook-профілю за його GraphQL story ID.
export default async function backdatePost({
    page,
    commonPayload,
    storyId,
    year,
    month,
    day,
    hour,
    minute,
    clientMutationId,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedDate = normalizeBackdate({ year, month, day, hour, minute });
    const normalizedStoryId = String(storyId ?? "").trim();
    const normalizedClientMutationId = String(clientMutationId ?? "").trim();

    if (
        validationError
        || missingRequestField
        || !normalizedStoryId
        || !normalizedDate
        || !normalizedClientMutationId
    ) {
        return createResult(false, backdatePostStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : (!normalizedStoryId
                        ? "Потрібен GraphQL storyId поста"
                        : (!normalizedDate
                            ? "Некоректна дата або час для backdate"
                            : "Потрібен clientMutationId поточного workflow"))),
        });
    }

    try {
        const profileId = String(commonPayload.__user);
        const normalizedTimeout = normalizeTimeout(timeout);
        const body = buildMutationBody(commonPayload, {
            friendlyName: backdateFriendlyName,
            docId: backdateDocId,
            variables: {
                input: {
                    backdate_info: normalizedDate,
                    story_id: normalizedStoryId,
                    actor_id: profileId,
                    client_mutation_id: normalizedClientMutationId,
                },
            },
            extraParameters: {
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: backdateFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizedTimeout,
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, backdatePostStatuses.REQUEST_TIMEOUT, null, {
                stage: "BACKDATE",
            });
        }
        if (response.requestError) {
            return createResult(false, backdatePostStatuses.REQUEST_FAILED, null, {
                stage: "BACKDATE",
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, backdatePostStatuses.HTTP_ERROR, null, {
                stage: "BACKDATE",
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, backdatePostStatuses.PARSE_ERROR, null, {
                stage: "BACKDATE",
                error: String(error?.message ?? error),
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, backdatePostStatuses.GRAPHQL_ERROR, data, {
                stage: "BACKDATE",
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, backdatePostStatuses.BACKDATED, {
            storyId: normalizedStoryId,
            ...normalizedDate,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, backdatePostStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
