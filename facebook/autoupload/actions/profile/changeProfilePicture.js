import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import changeCorePicture from "../../../api-actions/profile/changeProfilePicture.js";
import runProfileAction from "./runProfileAction.js";

function changeProfilePictureImpl(fbData, { imagePath }, options = {}) {
    return runProfileAction(fbData, options, page => changeCorePicture({ page, imagePath }), "Аватарку соціального профілю змінено");
}

export default tracedAction("changeProfilePicture", changeProfilePictureImpl, value => ({ profileId: value?.profileId ?? value?.fbData?.profileId ?? null }));
