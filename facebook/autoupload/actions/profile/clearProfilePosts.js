import clearCorePosts from "../../../api-workflows/profile/clearProfilePosts.js";
import runProfileAction from "./runProfileAction.js";

export default function clearProfilePosts(fbData, input = {}, options = {}) {
    return runProfileAction(fbData, options, page => clearCorePosts({ page, beforeAction: () => options.signal?.throwIfAborted() }), "Пости соціального профілю очищено");
}
