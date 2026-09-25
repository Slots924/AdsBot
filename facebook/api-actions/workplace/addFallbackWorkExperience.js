import { createResult } from "../education/common.js";
import createWorkExperience from "./createWorkExperience.js";


export const addFallbackWorkExperienceStatuses = Object.freeze({
    ADDED: "ADDED",
    FALLBACK_WORK_EXPERIENCES_UNAVAILABLE:
        "FALLBACK_WORK_EXPERIENCES_UNAVAILABLE",
});


// Список містить лише перевірені Facebook ID реальних компаній і посад.
const fallbackWorkExperiences = Object.freeze([
    {
        company_name: "DailyMedicalinfo.com",
        company_id: "100064558639221",
        position_name: "Eligibility interviewer",
        position_id: "779363895271430",
    },
    {
        company_name: "Alibaba.com",
        company_id: "100064687571319",
        position_name: "Electronics engineer",
        position_id: "863066426891581",
    },
    {
        company_name: "Booking.com",
        company_id: "100064404380905",
        position_name: "Electrical power-line installer and repairer",
        position_id: "854467281082129",
    },
    {
        company_name: "Yallakora.com",
        company_id: "100064377503992",
        position_name: "Electric motor technician",
        position_id: "819304704606143",
    },
    {
        company_name: "UrduPoint.com",
        company_id: "100044602352075",
        position_name: "Eligibility interviewer",
        position_id: "779363895271430",
    },
    {
        company_name: "Dhakapost.com",
        company_id: "100064843986297",
        position_name: "Electronics engineer",
        position_id: "863066426891581",
    },
    {
        company_name: "Kami.com.ph",
        company_id: "100064853313922",
        position_name: "Electric motor technician",
        position_id: "819304704606143",
    },
    {
        company_name: "BollywoodHungama.com",
        company_id: "100064560434240",
        position_name: "Eligibility interviewer",
        position_id: "779363895271430",
    },
    {
        company_name: "News24.com",
        company_id: "100064817165112",
        position_name: "Electronics engineer",
        position_id: "863066426891581",
    },
]);


// Вибирає випадкову пару реальних компанії та посади для fallback-додавання.
function selectFallbackWorkExperience() {
    if (fallbackWorkExperiences.length === 0) return null;

    const index = Math.floor(Math.random() * fallbackWorkExperiences.length);
    return fallbackWorkExperiences[index];
}


// Додає випадковий Work Experience з локального fallback-списку.
export default async function addFallbackWorkExperience({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    navChain,
    timeout,
}) {
    const fallbackWorkExperience = selectFallbackWorkExperience();
    if (!fallbackWorkExperience) {
        return createResult(
            false,
            addFallbackWorkExperienceStatuses.FALLBACK_WORK_EXPERIENCES_UNAVAILABLE
        );
    }

    const result = await createWorkExperience({
        page,
        commonPayload,
        collectionToken,
        sectionToken,
        companyId: fallbackWorkExperience.company_id,
        jobTitleId: fallbackWorkExperience.position_id,
        navChain,
        timeout,
    });

    return {
        ...result,
        status: result.success
            ? addFallbackWorkExperienceStatuses.ADDED
            : result.status,
        company: {
            id: fallbackWorkExperience.company_id,
            name: fallbackWorkExperience.company_name,
        },
        jobTitle: {
            id: fallbackWorkExperience.position_id,
            name: fallbackWorkExperience.position_name,
        },
    };
}
