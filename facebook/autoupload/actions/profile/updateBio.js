import updateCoreBio from "../../../api-actions/updateBio.js";
import getAboutSectionTokens from "./getAboutSectionTokens.js";
import runProfileAction from "./runProfileAction.js";
import getBio from "./getBio.js";

export default function updateBio(fbData, { value }, options = {}) {
    return runProfileAction(fbData, options, async page => {
        if (options.skipIfEmpty && value === "" && !(await getBio(page)).trim()) {
            return { success: true, status: "ALREADY_EMPTY", skipped: true };
        }
        const tokens = await getAboutSectionTokens(page, "directory_intro");
        return updateCoreBio({ page, ...tokens, value });
    }, "Bio соціального профілю оновлено");
}
