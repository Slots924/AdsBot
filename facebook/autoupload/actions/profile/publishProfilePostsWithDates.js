import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import publishCorePosts from "../../../api-workflows/profile/publishProfilePostsWithDates.js";
import runProfileAction from "./runProfileAction.js";

function publishProfilePostsWithDatesImpl(fbData, { posts }, options = {}) {
    return runProfileAction(fbData, options, page => publishCorePosts({ page, posts }), "Фото-пости соціального профілю опубліковано та датовано");
}

export default tracedAction("publishProfilePostsWithDates", publishProfilePostsWithDatesImpl, value => ({ profileId: value?.profileId ?? value?.fbData?.profileId ?? null }));
