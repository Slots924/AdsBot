import { defaultRelayVariables }
    from "../education/getEducationExperiences.js";
import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const friendlyName = "ProfileCometAboutAppSectionQuery";
const docId = "28598382689846669";


export const getWorkExperiencesStatuses = Object.freeze({
    WORK_EXPERIENCES_FOUND: "WORK_EXPERIENCES_FOUND",
    WORK_EXPERIENCES_NOT_FOUND: "WORK_EXPERIENCES_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    INVALID_RESPONSE: "INVALID_RESPONSE",
    PARSE_ERROR: "PARSE_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Дістає текст посади з першого текстового елемента Work Profile Field.
function extractPositionName(node) {
    for (const group of node?.list_item_groups ?? []) {
        for (const item of group?.list_items ?? []) {
            const text = item?.text?.text;
            if (typeof text === "string" && text.trim()) return text.trim();
        }
    }

    return null;
}


// Дістає всі реальні Work Experience з точного GraphQL-шляху About section response.
function extractWorkExperiences(data) {
    const experiences = [];
    const seen = new Set();
    const collections = data?.data?.user?.about_app_sections?.nodes ?? [];

    collections.forEach((collection) => {
        const activeCollections = collection?.activeCollections?.nodes ?? [];

        activeCollections.forEach((activeCollection) => {
            const sections = activeCollection?.style_renderer
                ?.profile_field_sections ?? [];

            sections.forEach((section) => {
                if (section?.field_section_type !== "directory_work") return;

                const nodes = section?.profile_fields?.nodes ?? [];
                nodes.forEach((node) => {
                    const workExperience = node?.edit_renderer?.work_experience;
                    const workExperienceId = workExperience?.id;
                    const companyName = node?.title?.text;

                    if (
                        node?.field_type !== "work"
                        || node?.edit_renderer?.__typename
                            !== "WorkProfileFieldEditDirectoryRenderer"
                        || !workExperienceId
                        || !companyName
                    ) {
                        return;
                    }

                    const id = String(workExperienceId);
                    if (seen.has(id)) return;

                    seen.add(id);
                    experiences.push({
                        company_name: companyName,
                        position_name: extractPositionName(node),
                        work_experience_id: id,
                    });
                });
            });
        });
    });

    return experiences;
}


// Отримує наявні Work Experience та їх ID через About App Section GraphQL query.
export default async function getWorkExperiences({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    rawSectionToken,
    relayVariables = {},
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    if (
        validationError
        || !collectionToken
        || !sectionToken
        || !rawSectionToken
        || typeof relayVariables !== "object"
        || Array.isArray(relayVariables)
    ) {
        return createResult(
            false,
            getWorkExperiencesStatuses.INVALID_INPUT,
            null,
            {
                error: validationError
                    ?? "Потрібні collectionToken, sectionToken, rawSectionToken і relayVariables-об'єкт",
            }
        );
    }

    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload[field] === undefined || commonPayload[field] === null);
    if (missingRequestField) {
        return createResult(
            false,
            getWorkExperiencesStatuses.INVALID_INPUT,
            null,
            { error: `У commonPayload відсутнє поле ${missingRequestField}` }
        );
    }

    const profileId = String(commonPayload.__user);
    const variables = {
        ...defaultRelayVariables,
        ...relayVariables,
        appSectionFeedKey:
            `ProfileCometAppSectionFeed_timeline_nav_app_sections__${rawSectionToken}`,
        collectionToken,
        pageID: profileId,
        rawSectionToken,
        scale: 1,
        sectionToken,
        showReactions: true,
        userID: profileId,
    };
    const body = buildMutationBody(commonPayload, {
        friendlyName,
        docId,
        variables,
        extraParameters: {
            __spin_r: commonPayload.__spin_r,
            __spin_b: commonPayload.__spin_b,
            __spin_t: commonPayload.__spin_t,
            __crn: commonPayload.__crn,
        },
    });

    try {
        const response = await postFacebookForm(page, {
            body,
            friendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, getWorkExperiencesStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(
                false,
                getWorkExperiencesStatuses.REQUEST_FAILED,
                null,
                { error: response.requestError }
            );
        }
        if (!response.ok) {
            return createResult(
                false,
                getWorkExperiencesStatuses.HTTP_ERROR,
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
                getWorkExperiencesStatuses.PARSE_ERROR,
                null,
                { error: String(error?.message ?? error) }
            );
        }
        if (hasGraphqlErrors(data)) {
            return createResult(
                false,
                getWorkExperiencesStatuses.GRAPHQL_ERROR,
                data,
                { httpStatus: response.statusCode }
            );
        }
        if (!data?.data?.user) {
            return createResult(
                false,
                getWorkExperiencesStatuses.INVALID_RESPONSE,
                null,
                {
                    error: "У GraphQL-відповіді відсутнє поле data.user",
                    httpStatus: response.statusCode,
                }
            );
        }

        const experiences = extractWorkExperiences(data);
        return createResult(
            true,
            experiences.length
                ? getWorkExperiencesStatuses.WORK_EXPERIENCES_FOUND
                : getWorkExperiencesStatuses.WORK_EXPERIENCES_NOT_FOUND,
            experiences,
            { httpStatus: response.statusCode }
        );
    } catch (error) {
        return createResult(false, getWorkExperiencesStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
