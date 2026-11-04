import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import changeCoreCover from "../../../api-actions/profile/changeCoverPhoto.js";
import runProfileAction from "./runProfileAction.js";

function changeCoverPhotoImpl(fbData, { imagePath }, options = {}) {
    return runProfileAction(fbData, options, page => changeCoreCover({ page, imagePath }), "Обкладинку соціального профілю змінено");
}

export default tracedAction("changeCoverPhoto", changeCoverPhotoImpl, value => ({ profileId: value?.profileId ?? value?.fbData?.profileId ?? null }));
