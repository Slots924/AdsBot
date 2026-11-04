import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import clearCorePosts from "../../../api-workflows/profile/clearProfilePosts.js";
import runProfileAction from "./runProfileAction.js";

function clearProfilePostsImpl(fbData, input = {}, options = {}) {
    return runProfileAction(fbData, options, page => clearCorePosts({ page, beforeAction: () => options.signal?.throwIfAborted() }), "Пости соціального профілю очищено");
}

export default tracedAction("clearProfilePosts", clearProfilePostsImpl, value => ({ profileId: value?.profileId ?? value?.fbData?.profileId ?? null }));
