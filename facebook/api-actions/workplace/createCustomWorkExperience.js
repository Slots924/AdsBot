import { randomUUID } from "node:crypto";

import createWorkExperience, {
    createWorkExperienceStatuses,
} from "./createWorkExperience.js";


export const createCustomWorkExperienceStatuses = Object.freeze({
    ...createWorkExperienceStatuses,
    INVALID_INPUT: "INVALID_INPUT",
});


// Створює власні Facebook-компанію та посаду в межах нового Work Experience.
export default async function createCustomWorkExperience({
    page,
    commonPayload,
    collectionToken,
    sectionToken,
    companyName,
    jobTitleName,
    navChain,
    timeout,
}) {
    if (typeof companyName !== "string" || !companyName.trim()
        || typeof jobTitleName !== "string" || !jobTitleName.trim()) {
        return {
            success: false,
            status: createCustomWorkExperienceStatuses.INVALID_INPUT,
            data: null,
            error: "Потрібні непорожні companyName і jobTitleName",
        };
    }

    const company = {
        id: randomUUID(),
        name: companyName.trim(),
    };
    const jobTitle = {
        id: randomUUID(),
        name: jobTitleName.trim(),
    };
    const result = await createWorkExperience({
        page,
        commonPayload,
        collectionToken,
        sectionToken,
        companyId: company.id,
        companyName: company.name,
        jobTitleId: jobTitle.id,
        jobTitleName: jobTitle.name,
        navChain,
        timeout,
    });

    return {
        ...result,
        company,
        jobTitle,
    };
}
