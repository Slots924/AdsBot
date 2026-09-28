import assert from "node:assert/strict";

import reauthAdditionalProfileAdmin, {
    reauthAdditionalProfileAdminStatuses,
} from "../facebook/api-actions/pages/reauthAdditionalProfileAdmin.js";


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
    __crn: "comet.genericcometdonotuse.CometProfilePlusProfessionalDashboardAdminPermissionsRoute",
};


// Імітує відповідь, яку безпечно повертає browser runtime після reauth mutation.
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
            admin_management_mark_reauthed: { reauth_is_successful: true },
        },
    }),
});
const result = await reauthAdditionalProfileAdmin({
    page,
    commonPayload,
    additionalProfileId: "61594979545862",
    password: "test-password",
});

assert.equal(result.success, true);
assert.equal(result.status, reauthAdditionalProfileAdminStatuses.REAUTHENTICATED);
assert.deepEqual(result.data, { additionalProfileId: "61594979545862" });
assert.equal(page.calls.length, 1);
assert.equal(page.calls[0].profileId, "61594979545862");
assert.equal(page.calls[0].timeoutMs, 30000);

const rejectedResult = await reauthAdditionalProfileAdmin({
    page: createPage({
        ok: true,
        statusCode: 200,
        body: JSON.stringify({
            data: { admin_management_mark_reauthed: { reauth_is_successful: false } },
        }),
    }),
    commonPayload,
    additionalProfileId: "61594979545862",
    password: "test-password",
});
assert.equal(rejectedResult.success, false);
assert.equal(rejectedResult.status, reauthAdditionalProfileAdminStatuses.REAUTH_NOT_CONFIRMED);

console.log("Перевірка Facebook action reauth additional profile admin пройшла успішно");
