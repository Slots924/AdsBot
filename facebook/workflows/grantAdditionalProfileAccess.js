import captureGraphqlPayload from "../api-actions/captureGraphqlPayload.js";
import inviteAdditionalProfileAdmin from "../api-actions/pages/inviteAdditionalProfileAdmin.js";
import reauthFacebookPassword from "../actions/reauthFacebookPassword.js";


const profileAccessUrl = "https://www.facebook.com/settings/?tab=profile_access";


// Відкриває Page access, оновлює payload поточного additional profile і надсилає invite.
export default async function grantAdditionalProfileAccess({
    page,
    additionalProfileId,
    targetUserId,
    password,
    timeout = 60000,
}) {
    const captured = await captureGraphqlPayload(page, {
        profileUrl: profileAccessUrl,
        timeout,
    });
    if (!captured.success) return { ...captured, stage: "CAPTURE_PROFILE_ACCESS_PAYLOAD" };

    const reauth = await reauthFacebookPassword(page, password, { timeout: 8000 });
    if (!reauth.success) return { ...reauth, stage: "REAUTH" };

    let commonPayload = captured.data;
    if (reauth.status === "REAUTHENTICATED") {
        const refreshed = await captureGraphqlPayload(page, {
            profileUrl: profileAccessUrl,
            timeout,
        });
        if (!refreshed.success) {
            return { ...refreshed, stage: "RECAPTURE_AFTER_REAUTH" };
        }
        commonPayload = refreshed.data;
    }

    const result = await inviteAdditionalProfileAdmin({
        page,
        commonPayload,
        additionalProfileId,
        targetUserId,
        timeout,
    });
    return { ...result, stage: "INVITE", reauthStatus: reauth.status };
}
