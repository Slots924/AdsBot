import { createResult } from "./common.js";
import createEducation from "./createEducation.js";
import searchCollege from "./searchCollege.js";


export const addEducationStatuses = Object.freeze({
    ADDED: "ADDED",
    COLLEGE_NOT_FOUND: "COLLEGE_NOT_FOUND",
});


// Обирає перший звичайний College із typeahead-відповіді Facebook.
function resolveCollege(options) {
    const college = options?.find((option) => (
        option?.fbid
        && option.fbid !== "-1"
        && typeof option.value === "string"
        && option.value.trim()
    ));

    return college
        ? {
            id: String(college.fbid),
            name: college.value.trim(),
        }
        : null;
}


// Додає College, знайдений за переданою назвою, без прихованого fallback.
export default async function addEducation({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    schoolName,
    timeout,
}) {
    const searchResult = await searchCollege({
        page,
        commonPayload,
        query: schoolName,
        timeout,
    });
    if (!searchResult.success) {
        return { ...searchResult, stage: "SEARCH" };
    }

    const school = resolveCollege(searchResult.data);
    if (!school) {
        return createResult(false, addEducationStatuses.COLLEGE_NOT_FOUND, null, {
            stage: "SEARCH",
            requestedSchoolName: schoolName,
        });
    }

    const mutationResult = await createEducation({
        page,
        commonPayload,
        collectionToken,
        sectionToken,
        schoolId: school.id,
        schoolName: school.name,
        timeout,
    });

    return {
        ...mutationResult,
        status: mutationResult.success
            ? addEducationStatuses.ADDED
            : mutationResult.status,
        stage: "CREATE",
        school,
    };
}
