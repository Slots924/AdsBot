import inviteAdditionalProfileAdmin from "../api-actions/pages/inviteAdditionalProfileAdmin.js";
import reauthAdditionalProfileAdmin from "../api-actions/pages/reauthAdditionalProfileAdmin.js";


// Виконує reauth і надсилає invite у вже підготовленому Facebook-контексті.
export default async function grantAdditionalProfileAccess({
    page,
    commonPayload,
    additionalProfileId,
    targetUserId,
    password,
    timeout = 60000,
}) {
    const reauth = await reauthAdditionalProfileAdmin({
        page,
        commonPayload,
        additionalProfileId,
        password,
        timeout,
    });
    if (!reauth.success) return { ...reauth, stage: "REAUTH" };

    const result = await inviteAdditionalProfileAdmin({
        page,
        commonPayload,
        additionalProfileId,
        targetUserId,
        timeout,
    });
    return { ...result, stage: "INVITE", reauthStatus: reauth.status };
}
