import changeCoreCover from "../../../api-actions/profile/changeCoverPhoto.js";
import runProfileAction from "./runProfileAction.js";

export default function changeCoverPhoto(fbData, { imagePath }, options = {}) {
    return runProfileAction(fbData, options, page => changeCoreCover({ page, imagePath }), "Обкладинку соціального профілю змінено");
}
