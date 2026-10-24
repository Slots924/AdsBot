import updateCoreBio from "../../../api-actions/updateBio.js";
import getAboutSectionTokens from "./getAboutSectionTokens.js";
import runProfileAction from "./runProfileAction.js";

export default function updateBio(fbData, { value }, options = {}) {
    return runProfileAction(fbData, options, async page => {
        const tokens = await getAboutSectionTokens(page, "directory_intro");
        return updateCoreBio({ page, ...tokens, value });
    }, "Bio соціального профілю оновлено");
}
