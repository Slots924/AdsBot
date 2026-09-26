import getAboutSectionTokens
    from "../../api-actions/getAboutSectionTokens.js";
import updateBio from "../../api-actions/updateBio.js";
import getEducationExperiences
    from "../../api-actions/education/getEducationExperiences.js";
import addEducation from "../../api-actions/education/addEducation.js";
import addFallbackEducation
    from "../../api-actions/education/addFallbackEducation.js";
import getWorkExperiences
    from "../../api-actions/workplace/getWorkExperiences.js";
import searchWorkplace from "../../api-actions/workplace/searchWorkplace.js";
import searchJobTitle from "../../api-actions/workplace/searchJobTitle.js";
import createWorkExperience
    from "../../api-actions/workplace/createWorkExperience.js";
import createCustomWorkExperience
    from "../../api-actions/workplace/createCustomWorkExperience.js";
import addFallbackWorkExperience
    from "../../api-actions/workplace/addFallbackWorkExperience.js";


export const fillProfileAboutStatuses = Object.freeze({
    COMPLETED: "COMPLETED",
    PARTIAL: "PARTIAL",
    TOKENS_FAILED: "TOKENS_FAILED",
    ERROR: "ERROR",
});


function step(success, status, extra = {}) {
    return { success, status, ...extra };
}


async function updateEducation({ page, commonPayload, tokens, schoolName, timeout }) {
    if (!tokens) return step(false, "TOKENS_NOT_FOUND");

    const current = await getEducationExperiences({
        page,
        commonPayload,
        ...tokens,
        timeout,
    });
    if (!current.success) return step(false, current.status);
    if (current.data.length > 0) {
        return step(true, "ALREADY_EXISTS", { count: current.data.length });
    }

    const primary = await addEducation({
        page,
        commonPayload,
        collectionToken: tokens.collectionToken,
        sectionToken: tokens.sectionToken,
        schoolName,
        timeout,
    });
    if (primary.success) return step(true, primary.status, { fallback: false });

    const fallback = await addFallbackEducation({
        page,
        commonPayload,
        collectionToken: tokens.collectionToken,
        sectionToken: tokens.sectionToken,
        timeout,
    });
    return step(fallback.success, fallback.status, {
        fallback: true,
        primaryStatus: primary.status,
    });
}


async function updateWork({ page, commonPayload, tokens, work, timeout }) {
    if (!tokens) return step(false, "TOKENS_NOT_FOUND");

    const current = await getWorkExperiences({
        page,
        commonPayload,
        ...tokens,
        timeout,
    });
    if (!current.success) return step(false, current.status);
    if (current.data.length > 0) {
        return step(true, "ALREADY_EXISTS", { count: current.data.length });
    }

    const companyName = String(work?.company ?? "").trim();
    const jobTitleName = String(work?.position ?? "").trim();
    let primary = null;
    if (companyName && jobTitleName) {
        const companyResult = await searchWorkplace({
            page,
            commonPayload,
            query: companyName,
            timeout,
        });
        const jobTitleResult = await searchJobTitle({
            page,
            commonPayload,
            query: jobTitleName,
            timeout,
        });
        const company = companyResult.success ? companyResult.data?.[0] : null;
        const jobTitle = jobTitleResult.success ? jobTitleResult.data?.[0] : null;

        primary = company && jobTitle
            ? await createWorkExperience({
                page,
                commonPayload,
                collectionToken: tokens.collectionToken,
                sectionToken: tokens.sectionToken,
                companyId: company.fbid,
                companyName: company.value,
                jobTitleId: jobTitle.fbid,
                jobTitleName: jobTitle.value,
                timeout,
            })
            : await createCustomWorkExperience({
                page,
                commonPayload,
                collectionToken: tokens.collectionToken,
                sectionToken: tokens.sectionToken,
                companyName,
                jobTitleName,
                timeout,
            });
    }
    if (primary?.success) return step(true, primary.status, { fallback: false });

    const fallback = await addFallbackWorkExperience({
        page,
        commonPayload,
        collectionToken: tokens.collectionToken,
        sectionToken: tokens.sectionToken,
        timeout,
    });
    return step(fallback.success, fallback.status, {
        fallback: true,
        primaryStatus: primary?.status ?? "MISSING_WORK_INPUT",
    });
}


// Очищає bio та незалежно оновлює освіту й роботу з локальними fallback-варіантами.
export default async function fillProfileAbout({
    page,
    commonPayload,
    fields = {},
    skipBio = false,
    timeout,
} = {}) {
    try {
        const tokenResult = await getAboutSectionTokens({
            page,
            commonPayload,
            sections: ["directory_bio", "directory_education", "directory_work"],
            timeout,
        });
        const tokens = tokenResult.data ?? {};
        if (!tokenResult.success && Object.keys(tokens).length === 0) {
            return {
                success: false,
                status: fillProfileAboutStatuses.TOKENS_FAILED,
                steps: {},
                actionStatus: tokenResult.status,
                error: tokenResult.error ?? tokenResult.status,
            };
        }

        const shouldUpdateBio = !skipBio;
        const bioTokens = tokens.directory_bio;
        const bioResult = !shouldUpdateBio
            ? step(true, "SKIPPED", { skipped: true })
            : bioTokens
            ? await updateBio({
                page,
                commonPayload,
                collectionToken: bioTokens.collectionToken,
                sectionToken: bioTokens.sectionToken,
                value: "",
                timeout,
            })
            : step(false, "TOKENS_NOT_FOUND");
        const educationResult = await updateEducation({
            page,
            commonPayload,
            tokens: tokens.directory_education,
            schoolName: fields.education,
            timeout,
        });
        const workResult = await updateWork({
            page,
            commonPayload,
            tokens: tokens.directory_work,
            work: fields.work,
            timeout,
        });
        const steps = {
            bio: step(bioResult.success, bioResult.status),
            education: educationResult,
            work: workResult,
        };
        const success = Object.values(steps).every((item) => item.success);

        return {
            success,
            status: success
                ? fillProfileAboutStatuses.COMPLETED
                : fillProfileAboutStatuses.PARTIAL,
            steps,
            error: success ? null : "Не всі поля About оновлено",
        };
    } catch (error) {
        return {
            success: false,
            status: fillProfileAboutStatuses.ERROR,
            steps: {},
            error: String(error?.message ?? error),
        };
    }
}
