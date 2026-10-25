import switchToAdditionalProfile from "../../../api-actions/pages/switchToAdditionalProfile.js";
import { actionError } from "../../graphql/errors.js";

export default async function switchToFanPage(context, additionalProfileId) {
    if (context.identity?.actorId === additionalProfileId) return;
    const result = await switchToAdditionalProfile({ page: context, additionalProfileId });
    if (!result.success) throw context.failure ?? actionError("Facebook не підтвердив перемикання", "FACEBOOK_SWITCH_NOT_CONFIRMED");
    await context.refresh();
    context.requireActor(additionalProfileId);
}
