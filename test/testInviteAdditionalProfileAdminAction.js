import assert from "node:assert/strict";

import inviteAdditionalProfileAdmin, {
    inviteAdditionalProfileAdminStatuses,
} from "../facebook/api-actions/pages/inviteAdditionalProfileAdmin.js";


const commonPayload = {
    av: "additional-profile-id",
    __user: "additional-profile-id",
    __a: "1",
    fb_dtsg: "token",
    jazoest: "25681",
    lsd: "lsd-token",
    __comet_req: "15",
    __spin_r: "1048592354",
    __spin_b: "trunk",
    __spin_t: "1790506573",
    __crn: "comet.fbweb.CometHomeRoute",
};


// Створює page-заглушку та зберігає параметри GraphQL mutation.
function createPage(response) {
    const calls = [];

    return {
        calls,
        async evaluate(_callback, argumentsObject) {
            calls.push(argumentsObject);
            return response;
        },
    };
}


const page = createPage({
    ok: true,
    statusCode: 200,
    body: JSON.stringify({
        data: {
            profile_plus_core_admin_invite: {
                is_invite_sent: true,
                admin_type: "FULL_ACCESS",
                permissions: ["Ads", "Insights"],
                profile_admin_invite_id: "invite-id",
                days_until_expiration: 30,
            },
        },
    }),
});
const result = await inviteAdditionalProfileAdmin({
    page,
    commonPayload,
    additionalProfileId: "61594979545862",
    targetUserId: "61594188892743",
});

assert.equal(result.success, true);
assert.equal(result.status, inviteAdditionalProfileAdminStatuses.INVITE_SENT);
assert.deepEqual(result.data, {
    additionalProfileId: "61594979545862",
    targetUserId: "61594188892743",
    adminType: "FULL_ACCESS",
    permissions: ["Ads", "Insights"],
    profileAdminInviteId: "invite-id",
    daysUntilExpiration: 30,
});

const parameters = new URLSearchParams(page.calls[0].requestBody);
assert.equal(
    parameters.get("fb_api_req_friendly_name"),
    "ProfilePlusCoreAppAdminInviteMutation"
);
assert.equal(parameters.get("doc_id"), "27622438327347937");
assert.deepEqual(JSON.parse(parameters.get("variables")), {
    input: {
        additional_profile_id: "61594979545862",
        admin_id: "61594188892743",
        grant_full_control: true,
        actor_id: "61594979545862",
        client_mutation_id: "2",
    },
    scale: 1,
});

const notSentResult = await inviteAdditionalProfileAdmin({
    page: createPage({
        ok: true,
        statusCode: 200,
        body: JSON.stringify({
            data: { profile_plus_core_admin_invite: { is_invite_sent: false } },
        }),
    }),
    commonPayload,
    additionalProfileId: "61594979545862",
    targetUserId: "61594188892743",
});

assert.equal(notSentResult.success, false);
assert.equal(notSentResult.status, inviteAdditionalProfileAdminStatuses.INVITE_NOT_SENT);

console.log("Перевірка Facebook action invite additional profile admin пройшла успішно");
