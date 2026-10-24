import { updateEducationField, updateWorkField } from "../../../api-workflows/profile/fillProfileAbout.js";
import getAboutSectionTokens from "./getAboutSectionTokens.js";
import runProfileAction from "./runProfileAction.js";

export default function updateAbout(fbData, { education, work }, options = {}) {
    return runProfileAction(fbData, options, async page => {
        const steps = {};
        const beforeAction = () => options.signal?.throwIfAborted();
        if (education) {
            const tokens = await getAboutSectionTokens(page, "directory_education");
            steps.education = await updateEducationField({ page, tokens, schoolName: education, replaceExisting: true, allowFallback: false, beforeAction });
        }
        if (work?.company && work?.position) {
            const tokens = await getAboutSectionTokens(page, "directory_work");
            steps.work = await updateWorkField({ page, tokens, work, replaceExisting: true, allowFallback: false, beforeAction });
        }
        const success = Object.keys(steps).length > 0 && Object.values(steps).every(step => step.success);
        return { success, status: success ? "COMPLETED" : "PARTIAL", steps };
    }, "Інформацію про освіту та роботу соціального профілю оновлено");
}
