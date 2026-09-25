import { createResult } from "./common.js";
import createEducation from "./createEducation.js";


export const addFallbackEducationStatuses = Object.freeze({
    ADDED: "ADDED",
    FALLBACK_INSTITUTIONS_UNAVAILABLE: "FALLBACK_INSTITUTIONS_UNAVAILABLE",
});


// Список містить лише перевірені Facebook ID; нові заклади додаються сюди за потреби.
const fallbackInstitutions = Object.freeze([
    {
        id: "10593065111",
        name: "Harvard University",
    },
]);


// Вибирає випадковий заклад для fallback-додавання College.
function selectFallbackInstitution() {
    if (fallbackInstitutions.length === 0) return null;

    const index = Math.floor(Math.random() * fallbackInstitutions.length);
    return fallbackInstitutions[index];
}


// Додає випадковий заклад із локального fallback-списку без пошуку typeahead.
export default async function addFallbackEducation({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    timeout,
}) {
    const school = selectFallbackInstitution();
    if (!school) {
        return createResult(
            false,
            addFallbackEducationStatuses.FALLBACK_INSTITUTIONS_UNAVAILABLE
        );
    }

    const result = await createEducation({
        page,
        commonPayload,
        collectionToken,
        sectionToken,
        schoolId: school.id,
        schoolName: school.name,
        timeout,
    });

    return {
        ...result,
        status: result.success
            ? addFallbackEducationStatuses.ADDED
            : result.status,
        stage: "CREATE",
        school,
    };
}
