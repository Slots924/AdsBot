import publishCorePosts from "../../../api-workflows/profile/publishProfilePostsWithDates.js";
import runProfileAction from "./runProfileAction.js";

export default function publishProfilePostsWithDates(fbData, { posts }, options = {}) {
    return runProfileAction(fbData, options, page => publishCorePosts({ page, posts }), "Фото-пости соціального профілю опубліковано та датовано");
}
