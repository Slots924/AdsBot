import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import switchToAdditionalProfile from "../../../api-actions/pages/switchToAdditionalProfile.js";
import { actionError } from "../../graphql/errors.js";

async function switchToFanPageImpl(context, additionalProfileId) {
    if (context.identity?.actorId === additionalProfileId) return;
    const result = await switchToAdditionalProfile({ page: context, additionalProfileId });
    if (!result.success) throw context.failure ?? actionError("Facebook не підтвердив перемикання", "FACEBOOK_SWITCH_NOT_CONFIRMED");
    await context.refresh();
    context.requireActor(additionalProfileId);
}

export default tracedAction("switchToFanPage", switchToFanPageImpl, value => ({ profileId: value?.profileId ?? value?.fbData?.profileId ?? null }));
