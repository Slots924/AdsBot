import { adminPermissionsQuery } from "../../../api/pages/adminAccessOperations.js";
import { actionError } from "../../graphql/errors.js";

// Шукає UID лише в полях користувача, не порівнюючи назви чи інші довільні значення.
function containsUserId(value, userId) {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(([key, item]) =>
        (["id", "user_id", "admin_id"].includes(key) && String(item) === userId) || containsUserId(item, userId));
}

export default async function getFanPageAdminPermissions(context, additionalProfileId, targetUserId) {
    context.requireActor(additionalProfileId);
    const { chunks } = await context.graphql({ ...adminPermissionsQuery, variables: { scale: 1 } });
    const actor = chunks.find(chunk => chunk.data?.viewer?.actor)?.data.viewer.actor;
    if (String(actor?.id ?? "") !== additionalProfileId
        || !Object.hasOwn(actor, "outgoing_core_app_admin_invites") || !Object.hasOwn(actor, "full_control_users")) {
        throw actionError("Facebook не повернув доступи потрібної фанки", "FACEBOOK_PAGE_PERMISSIONS_INVALID");
    }
    return {
        pageName: actor.name ?? null,
        invitePending: containsUserId(actor.outgoing_core_app_admin_invites, targetUserId),
        hasFullControl: containsUserId(actor.full_control_users, targetUserId),
        encryptionKeys: actor.public_key_and_id_for_encryption ?? null,
    };
}
