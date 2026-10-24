import changeCorePicture from "../../../api-actions/profile/changeProfilePicture.js";
import runProfileAction from "./runProfileAction.js";

export default function changeProfilePicture(fbData, { imagePath }, options = {}) {
    return runProfileAction(fbData, options, page => changeCorePicture({ page, imagePath }), "Аватарку соціального профілю змінено");
}
