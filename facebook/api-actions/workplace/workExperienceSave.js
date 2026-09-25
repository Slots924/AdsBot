export const workExperienceSaveFriendlyName =
    "ProfileCometWorkExperienceSaveMutation";
export const workExperienceSaveDocId = "28139493225713374";
export const workExperienceRouteName =
    "comet.fbweb.CometProfileDirectoryWorkTabRoute";


// Перевіряє дані сесії, обов'язкові для Work mutation.
export function getWorkMutationValidationError(commonPayload) {
    const missingSessionField = ["__spin_r", "__spin_b", "__spin_t"].find(
        (field) => commonPayload?.[field] === undefined
            || commonPayload[field] === null
    );

    if (missingSessionField) {
        return `У commonPayload відсутнє поле ${missingSessionField}`;
    }
    return null;
}


// Формує input для створення Work Experience з наявною компанією та посадою.
export function buildWorkExperienceInput({
    actorId,
    companyId,
    companyName = null,
    jobTitleId,
    jobTitleName = null,
    navChain,
}) {
    const input = {
        description: "",
        employer_id: String(companyId),
        employer_name: companyName,
        end_date: {},
        is_current: true,
        location_id: "",
        mutation_surface: "PROFILE",
        position_id: String(jobTitleId),
        position_name: jobTitleName,
        privacy: {
            allow: [],
            base_state: "EVERYONE",
            deny: [],
            tag_expansion_state: "UNSPECIFIED",
        },
        start_date: {},
        actor_id: String(actorId),
        client_mutation_id: "1",
    };

    if (typeof navChain === "string" && navChain.trim()) {
        input.logging_data = {
            nav_chain: navChain.trim(),
        };
    }

    return input;
}


// Формує variables для create mutation Work Experience.
export function buildWorkExperienceSaveVariables({
    commonPayload,
    collectionToken,
    sectionToken,
    companyId,
    companyName = null,
    jobTitleId,
    jobTitleName = null,
    navChain,
}) {
    return {
        collectionToken,
        input: buildWorkExperienceInput({
            actorId: commonPayload.__user,
            companyId,
            companyName,
            jobTitleId,
            jobTitleName,
            navChain,
        }),
        scale: 1,
        sectionToken,
        profileID: String(commonPayload.__user),
        workExperienceID: null,
        isProfileDirectory: true,
        shouldFetchPostClick: false,
        __relay_internal__pv__ProfileCometFeaturedHighlightsPortraitAspectRatioGKrelayprovider: false,
    };
}
