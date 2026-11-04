import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import { adminReauthMutation } from "../../../api/pages/adminAccessOperations.js";
import { actionError } from "../../graphql/errors.js";

async function reauthFanPageAdminImpl(context, additionalProfileId, encryptedPassword) {
    context.requireActor(additionalProfileId);
    const { chunks } = await context.graphql({ ...adminReauthMutation, variables: { input: {
        password: { sensitive_string_value: encryptedPassword }, actor_id: additionalProfileId, client_mutation_id: "1",
    } } });
    if (!chunks.some(chunk => chunk.data?.admin_management_mark_reauthed?.reauth_is_successful === true)) {
        throw actionError("Facebook не підтвердив пароль", "FACEBOOK_REAUTH_NOT_CONFIRMED");
    }
}

export default tracedAction("reauthFanPageAdmin", reauthFanPageAdminImpl, value => ({ profileId: value?.profileId ?? value?.fbData?.profileId ?? null }));
