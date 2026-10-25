import inviteAdditionalProfileAdmin from "../../../api-actions/pages/inviteAdditionalProfileAdmin.js";
import { actionError } from "../../graphql/errors.js";

export default async function inviteFanPageAdmin(context, additionalProfileId, targetUserId) {
    context.requireActor(additionalProfileId);
    const result = await inviteAdditionalProfileAdmin({ page: context, additionalProfileId, targetUserId });
    if (!result.success) throw context.failure ?? actionError("Facebook не підтвердив надсилання інвайту", "FACEBOOK_INVITE_NOT_CONFIRMED", {
        outcomeUnknown: result.status !== "INVALID_INPUT", httpStatus: result.httpStatus ?? null,
    });
    return result;
}
