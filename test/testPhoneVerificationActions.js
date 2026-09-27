import assert from "node:assert/strict";

import requestPhoneVerificationCode, {
    requestPhoneVerificationCodeStatuses,
} from "../facebook/api-actions/phone-verification/requestPhoneVerificationCode.js";
import submitPhoneVerificationCode, {
    submitPhoneVerificationCodeStatuses,
} from "../facebook/api-actions/phone-verification/submitPhoneVerificationCode.js";


const commonPayload = {
    av: "61593928954145",
    __user: "61593928954145",
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


// Створює page-заглушку з чергою відповідей GraphQL та записом request body.
function createPage(responses) {
    const calls = [];

    return {
        calls,
        async evaluate(_callback, argumentsObject) {
            const response = responses.shift();
            assert(response, "Отримано неочікуваний GraphQL-запит");
            calls.push(argumentsObject);
            return response;
        },
    };
}


const successResponse = (body) => ({
    ok: true,
    statusCode: 200,
    body: JSON.stringify(body),
});


const requestPage = createPage([
    successResponse({
        data: {
            ixt_xfac_bv_trigger: {
                screen: {
                    display_type: "OVERLAY",
                    view_model: {
                        __typename: "BVWizardAdvertiserVerificationEnterPhoneIXTScreenViewModel",
                        serialized_state: "state-1",
                    },
                },
            },
        },
    }),
    successResponse({
        data: {
            ixt_screen_next: {
                view_model: {
                    __typename: "ChallengeSelectIXTScreenViewModel",
                    serialized_state: "state-2",
                    bv_wizard_challenge_select_screen: {
                        challenge_method_options: ["SMS", "WHATSAPP_MESSAGE", "ROBOCALL"],
                    },
                },
            },
        },
    }),
    successResponse({
        data: {
            ixt_screen_next: {
                view_model: {
                    __typename: "ChallengeSMSConfirmIXTScreenViewModel",
                    serialized_state: "state-3",
                    bv_wizard_challenge_sms_confirm_screen: {
                        phone_number: "(730) 278-4461",
                    },
                },
            },
        },
    }),
    successResponse({
        data: {
            ixt_screen_next: {
                view_model: {
                    __typename: "ChallengeSMSEnterCodeIXTScreenViewModel",
                    serialized_state: "state-4",
                    submission_id: "submission-id",
                    bv_wizard_challenge_sms_enter_code_screen: {
                        phone_number: "(730) 278-4461",
                    },
                },
            },
        },
    }),
]);
const requestResult = await requestPhoneVerificationCode({
    page: requestPage,
    commonPayload,
    adAccountId: "act_123",
    phoneE164: "+17302784461",
    countryCode: "us",
    locale: "en_GB",
    triggerSessionId: "test-trigger-session",
});

assert.equal(requestResult.success, true);
assert.equal(
    requestResult.status,
    requestPhoneVerificationCodeStatuses.SMS_CODE_SENT
);
assert.equal(requestResult.data.flow.serializedState, "state-4");
assert.equal(requestResult.data.flow.phoneDisplay, "(730) 278-4461");
assert.equal(requestPage.calls.length, 4);

const rootParameters = new URLSearchParams(requestPage.calls[0].requestBody);
assert.equal(
    rootParameters.get("fb_api_req_friendly_name"),
    "CometIXTFacebookXfacBvTriggerRootQuery"
);
assert.equal(rootParameters.get("doc_id"), "28631875969757608");
assert.equal(rootParameters.get("__aaid"), "act_123");
assert.equal(
    JSON.parse(rootParameters.get("variables")).input.trigger_session_id,
    "test-trigger-session"
);

const sendSmsParameters = new URLSearchParams(requestPage.calls[3].requestBody);
assert.deepEqual(
    JSON.parse(sendSmsParameters.get("variables")).input.challenge_sms_confirm,
    {
        phone_number: "(730) 278-4461",
        serialized_state: "state-3",
    }
);

const submitPage = createPage([successResponse({
    data: {
        ixt_screen_next: {
            view_model: {
                __typename: "XFBBVWizardAdvertiserVerificationAdsManagerPhoneConsentIXTScreenViewModel",
                serialized_state: "state-5",
                submission_id: "submission-id",
            },
        },
    },
})]);
const submitResult = await submitPhoneVerificationCode({
    page: submitPage,
    commonPayload,
    flow: requestResult.data.flow,
    code: "123456",
});

assert.equal(submitResult.success, true);
assert.equal(
    submitResult.status,
    submitPhoneVerificationCodeStatuses.PHONE_VERIFIED
);
assert.equal(submitResult.phoneVerified, true);
assert.equal(submitResult.optionalConsentRequired, true);
assert.equal(submitResult.data.flow.serializedState, "state-5");

const submitParameters = new URLSearchParams(submitPage.calls[0].requestBody);
assert.deepEqual(
    JSON.parse(submitParameters.get("variables")).input.challenge_sms_enter_code,
    {
        check_id: null,
        code: "123456",
        serialized_state: "state-4",
    }
);

const unsupportedMethodResult = await requestPhoneVerificationCode({
    page: createPage([]),
    commonPayload,
    adAccountId: "act_123",
    phoneE164: "+17302784461",
    countryCode: "US",
    locale: "en_GB",
    method: "WHATSAPP_MESSAGE",
});

assert.equal(unsupportedMethodResult.success, false);
assert.equal(
    unsupportedMethodResult.status,
    requestPhoneVerificationCodeStatuses.METHOD_NOT_IMPLEMENTED
);

console.log("Перевірка Facebook actions phone verification пройшла успішно");
