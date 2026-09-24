export const educationSaveFriendlyName =
    "useProfileCometEducationExperienceSaveMutationQuery";
export const educationSaveDocId = "29412080681715370";


// Формує повний input для створення або зміни College.
export function buildEducationInput({
    actorId,
    schoolId,
    schoolName,
    educationExperienceID = null,
}) {
    const input = {
        actor_id: String(actorId),
        activity_ids: [],
        activity_names: [],
        classes: "",
        concentrations: [],
        degree_name: "",
        description: "",
        dorm: "",
        end: {},
        start: {},
        has_graduated: false,
        school_id: String(schoolId),
        school_name: schoolName,
        school_type: "college",
        privacy: {
            allow: [],
            base_state: "EVERYONE",
            deny: [],
            tag_expansion_state: "UNSPECIFIED",
        },
        mutation_surface: "PROFILE",
    };

    if (educationExperienceID) {
        input.experience_id = String(educationExperienceID);
    }

    return input;
}


// Формує variables для Save mutation College.
export function buildEducationSaveVariables({
    commonPayload,
    collectionToken,
    sectionToken,
    schoolId,
    schoolName,
    educationExperienceID = null,
}) {
    return {
        collectionToken,
        input: buildEducationInput({
            actorId: commonPayload.__user,
            schoolId,
            schoolName,
            educationExperienceID,
        }),
        scale: 1,
        sectionToken,
        profileID: String(commonPayload.__user),
        educationExperienceID: educationExperienceID
            ? String(educationExperienceID)
            : null,
        __relay_internal__pv__ProfileCometFeaturedHighlightsPortraitAspectRatioGKrelayprovider: false,
    };
}
