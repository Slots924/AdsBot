import getAboutSectionTokens
    from "../../api-actions/getAboutSectionTokens.js";
import updateBio from "../../api-actions/updateBio.js";
import getEducationExperiences
    from "../../api-actions/education/getEducationExperiences.js";
import addEducation from "../../api-actions/education/addEducation.js";
import addFallbackEducation
    from "../../api-actions/education/addFallbackEducation.js";
import searchCollege from "../../api-actions/education/searchCollege.js";
import saveEducation from "../../api-actions/education/updateEducation.js";
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
import deleteWorkExperience from "../../api-actions/workplace/deleteWorkExperience.js";


export const fillProfileAboutStatuses = Object.freeze({
    COMPLETED: "COMPLETED",
    PARTIAL: "PARTIAL",
    TOKENS_FAILED: "TOKENS_FAILED",
    ERROR: "ERROR",
});


function step(success, status, extra = {}) {
    return { success, status, ...extra };
}


async function perform(action, input, beforeAction) {
    await beforeAction();
    return action(input);
}

export async function updateEducationField({ page, tokens, schoolName, timeout,
    replaceExisting = false, allowFallback = true, beforeAction = async () => {},
}) {
    if (!tokens) return step(false, "TOKENS_NOT_FOUND");
    if (replaceExisting && !String(schoolName ?? "").trim()) return step(true, "SKIPPED", { skipped: true });

    const current = await perform(getEducationExperiences, {
        page,
        ...tokens,
        timeout,
    }, beforeAction);
    if (!current.success) return current;
    if (current.data.length > 0) {
        if (!replaceExisting) return step(true, "ALREADY_EXISTS", { count: current.data.length });
        const search = await perform(searchCollege, { page, query: schoolName, timeout }, beforeAction);
        if (!search.success) return search;
        const school = search.data?.find((item) => item.fbid && item.fbid !== "-1" && item.value?.trim());
        if (!school) return step(false, "COLLEGE_NOT_FOUND", { error: "Не знайдено вказаний навчальний заклад" });
        return perform(saveEducation, {
            page, ...tokens, educationExperienceID: current.data[0].education_experience_id,
            schoolId: school.fbid, schoolName: school.value, timeout,
        }, beforeAction);
    }

    const primary = await perform(addEducation, {
        page,
        collectionToken: tokens.collectionToken,
        sectionToken: tokens.sectionToken,
        schoolName,
        timeout,
    }, beforeAction);
    if (primary.success) return step(true, primary.status, { fallback: false });
    if (!allowFallback) return primary;

    const fallback = await perform(addFallbackEducation, {
        page,
        collectionToken: tokens.collectionToken,
        sectionToken: tokens.sectionToken,
        timeout,
    }, beforeAction);
    return step(fallback.success, fallback.status, {
        fallback: true,
        primaryStatus: primary.status,
    });
}


export async function updateWorkField({ page, tokens, work, timeout,
    replaceExisting = false, allowFallback = true, beforeAction = async () => {},
}) {
    if (!tokens) return step(false, "TOKENS_NOT_FOUND");
    const companyName = String(work?.company ?? "").trim();
    const jobTitleName = String(work?.position ?? "").trim();
    if (replaceExisting && (!companyName || !jobTitleName)) return step(true, "SKIPPED", { skipped: true });

    const current = await perform(getWorkExperiences, {
        page,
        ...tokens,
        timeout,
    }, beforeAction);
    if (!current.success) return current;
    if (current.data.length > 0 && !replaceExisting) {
        return step(true, "ALREADY_EXISTS", { count: current.data.length });
    }

    let primary = null;
    if (companyName && jobTitleName) {
        const companyResult = await perform(searchWorkplace, {
            page,
            query: companyName,
            timeout,
        }, beforeAction);
        const jobTitleResult = await perform(searchJobTitle, {
            page,
            query: jobTitleName,
            timeout,
        }, beforeAction);
        if (replaceExisting && !companyResult.success) return companyResult;
        if (replaceExisting && !jobTitleResult.success) return jobTitleResult;
        const company = companyResult.success ? companyResult.data?.[0] : null;
        const jobTitle = jobTitleResult.success ? jobTitleResult.data?.[0] : null;

        primary = company && jobTitle
            ? await perform(createWorkExperience, {
                page,
                collectionToken: tokens.collectionToken,
                sectionToken: tokens.sectionToken,
                companyId: company.fbid,
                companyName: company.value,
                jobTitleId: jobTitle.fbid,
                jobTitleName: jobTitle.value,
                timeout,
            }, beforeAction)
            : await perform(createCustomWorkExperience, {
                page,
                collectionToken: tokens.collectionToken,
                sectionToken: tokens.sectionToken,
                companyName,
                jobTitleName,
                timeout,
            }, beforeAction);
    }
    if (primary?.success) {
        if (replaceExisting && current.data.length > 0) {
            // Видаляє попередній запис лише після успішного додавання нового.
            const removed = await perform(deleteWorkExperience, {
                page, ...tokens, workExperienceID: current.data[0].work_experience_id, timeout,
            }, beforeAction);
            if (!removed.success) return step(false, removed.status, {
                error: removed.error || "Нову роботу додано, але попередній запис не вдалося видалити",
                created: true,
            });
        }
        return step(true, primary.status, { fallback: false });
    }
    if (!allowFallback) return primary ?? step(false, "MISSING_WORK_INPUT");

    const fallback = await perform(addFallbackWorkExperience, {
        page,
        collectionToken: tokens.collectionToken,
        sectionToken: tokens.sectionToken,
        timeout,
    }, beforeAction);
    return step(fallback.success, fallback.status, {
        fallback: true,
        primaryStatus: primary?.status ?? "MISSING_WORK_INPUT",
    });
}


// Очищає bio та незалежно оновлює освіту й роботу з локальними fallback-варіантами.
export default async function fillProfileAbout({
    page,
    fields = {},
    skipBio = false,
    timeout,
} = {}) {
    try {
        const tokenResult = await getAboutSectionTokens({
            page,
            sections: ["directory_intro", "directory_education", "directory_work"],
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
        const bioTokens = tokens.directory_intro;
        const bioResult = !shouldUpdateBio
            ? step(true, "SKIPPED", { skipped: true })
            : bioTokens
            ? await updateBio({
                page,
                collectionToken: bioTokens.collectionToken,
                sectionToken: bioTokens.sectionToken,
                value: "",
                timeout,
            })
            : step(false, "TOKENS_NOT_FOUND");
        const educationResult = await updateEducationField({
            page,
            tokens: tokens.directory_education,
            schoolName: fields.education,
            timeout,
        });
        const workResult = await updateWorkField({
            page,
            tokens: tokens.directory_work,
            work: fields.work,
            timeout,
        });
        const steps = {
            bio: step(bioResult.success, bioResult.status, {
                error: bioResult.error ?? null,
                httpStatus: bioResult.httpStatus ?? null,
            }),
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
