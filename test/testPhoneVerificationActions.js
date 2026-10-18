import { withFacebookRuntime } from "./helpers/facebookRuntimePage.js";
import assert from "node:assert/strict";

import requestPhoneVerificationCode, {
    requestPhoneVerificationCodeStatuses,
} from "../facebook/api-actions/phone-verification/requestPhoneVerificationCode.js";
import submitPhoneVerificationCode, {
    submitPhoneVerificationCodeStatuses,
} from "../facebook/api-actions/phone-verification/submitPhoneVerificationCode.js";


const runtimeFixture = {
    __user: "61593928954145",
    __a: "1",
    fb_dtsg: "token",
    jazoest: "25681",
    lsd: "lsd-token",
    __comet_req: "15",
    __spin_r: "1048592354",
    __spin_b: "trunk",
    __spin_t: "1790506573",
};


// Створює page-заглушку з чергою відповідей GraphQL та записом request body.
function createPage(responses) {
    const calls = [];

    return withFacebookRuntime({
        calls,
        async evaluate(_callback, argumentsObject) {
            const response = responses.shift();
            assert(response, "Отримано неочікуваний GraphQL-запит");
            calls.push(argumentsObject);
            return response;
        },
    }, { surface: "adsManager", runtime: runtimeFixture });
}


const successResponse = (body) => ({
    ok: true,
    statusCode: 200,
    body: JSON.stringify(body),
});


const smsResponses = [
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
                    challenge_select_screen_content_renderer: {
                        bv_wizard_challenge_select_screen: {
                            challenge_method_options: ["SMS", "WHATSAPP_MESSAGE", "ROBOCALL"],
                        },
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
];
const requestPage = createPage(structuredClone(smsResponses));
const requestResult = await requestPhoneVerificationCode({
    page: requestPage,
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
assert.equal(rootParameters.get("doc_id"), "29392639113662669");
assert.equal(rootParameters.get("__aaid"), "act_123");
assert.equal(rootParameters.get("av"), runtimeFixture.__user);
assert.equal(rootParameters.get("__crn"), null);
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

// Перевіряє обидва старти та передавання актуального стану на кожному кроці.
const requestInput = {
    adAccountId: "act_123",
    phoneE164: "+17302784461",
    countryCode: "US",
    locale: "en_US",
};
const mutationInput = (call) => JSON.parse(new URLSearchParams(call.requestBody).get("variables")).input;
const sharingViewModel = {
    __typename: "BVWizardVerificationSharingSelectionIXTScreenViewModel",
    serialized_state: "sharing-state",
    bv_wizard_option_selection_screen_content_renderer: {
        options: [
            { option: "existing-number-id", is_alternative_option: false },
            { option: "alternative_option", is_alternative_option: true },
        ],
    },
};
const rootResponse = (viewModel) => successResponse({
    data: { ixt_xfac_bv_trigger: { screen: { view_model: viewModel } } },
});
const enterPhoneViewModel = JSON.parse(smsResponses[0].body)
    .data.ixt_xfac_bv_trigger.screen.view_model;
const enterPhoneNextResponse = successResponse({
    data: { ixt_screen_next: { view_model: enterPhoneViewModel } },
});
const sharingPage = createPage([
    rootResponse(sharingViewModel),
    enterPhoneNextResponse,
    ...structuredClone(smsResponses.slice(1)),
]);
const sharingResult = await requestPhoneVerificationCode({ ...requestInput, page: sharingPage });
assert.equal(sharingResult.status, requestPhoneVerificationCodeStatuses.SMS_CODE_SENT);
assert.equal(sharingResult.data.flow.serializedState, "state-4");
assert.equal(sharingPage.calls.length, 5);
assert.deepEqual(mutationInput(sharingPage.calls[1]), {
    bv_wizard_verification_sharing_selection: {
        option: "alternative_option",
        serialized_state: "sharing-state",
    },
    actor_id: runtimeFixture.__user,
    client_mutation_id: "1",
});
assert.equal(mutationInput(sharingPage.calls[2])
    .bv_wizard_advertiser_verification_enter_phone.serialized_state, "state-1");
assert.equal(mutationInput(sharingPage.calls[2])
    .bv_wizard_advertiser_verification_enter_phone.phone_number, requestInput.phoneE164);
for (const page of [requestPage, sharingPage]) {
    page.calls.slice(1).forEach((call, index) => {
        assert.equal(mutationInput(call).client_mutation_id, String(index + 1));
        assert.equal(new URLSearchParams(call.requestBody).get("doc_id"), "29322112374040538");
    });
}

// Невідомі та неповні екрани не повинні спричиняти вибір старого номера або повторні mutation.
for (const viewModel of [
    { __typename: "UnknownScreen", serialized_state: "unknown-state" },
    { ...enterPhoneViewModel, serialized_state: null },
    { ...sharingViewModel, serialized_state: null },
    { ...sharingViewModel, bv_wizard_option_selection_screen_content_renderer: { options: [
        { option: "existing-number-id", is_alternative_option: false },
    ] } },
    { ...sharingViewModel, bv_wizard_option_selection_screen_content_renderer: { options: null } },
]) {
    const page = createPage([rootResponse(viewModel)]);
    const result = await requestPhoneVerificationCode({ ...requestInput, page });
    assert.equal(result.status, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN);
    assert.equal(result.actualScreenType, viewModel.__typename);
    assert.equal(page.calls.length, 1);
}

for (const viewModel of [sharingViewModel, { __typename: "UnknownNextScreen" },
    { ...enterPhoneViewModel, serialized_state: null }]) {
    const page = createPage([rootResponse(sharingViewModel), successResponse({
        data: { ixt_screen_next: { view_model: viewModel } },
    })]);
    const result = await requestPhoneVerificationCode({ ...requestInput, page });
    assert.equal(result.status, requestPhoneVerificationCodeStatuses.UNEXPECTED_SCREEN);
    assert.equal(result.stage, "SELECT_DIFFERENT_PHONE");
    assert.equal(result.actualScreenType, viewModel.__typename);
    assert.equal(page.calls.length, 2);
}

for (const [response, expectedStatus] of [
    [successResponse({ errors: [{ message: "Rejected" }] }), "GRAPHQL_ERROR"],
    [{ ok: false, statusCode: 503 }, "HTTP_ERROR"],
    [{ requestError: "TIMEOUT" }, "REQUEST_TIMEOUT"],
]) {
    const page = createPage([rootResponse(sharingViewModel), response]);
    const result = await requestPhoneVerificationCode({ ...requestInput, page });
    assert.equal(result.status, expectedStatus);
    assert.equal(result.stage, "SELECT_DIFFERENT_PHONE");
    assert.equal(page.calls.length, 2);
}

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
assert.equal(submitParameters.get("doc_id"), "29322112374040538");
assert.deepEqual(
    JSON.parse(submitParameters.get("variables")).input.challenge_sms_enter_code,
    {
        check_id: null,
        code: "123456",
        serialized_state: "state-4",
    }
);

const whatsappPage = createPage([
    successResponse({
        data: {
            ixt_xfac_bv_trigger: {
                screen: {
                    view_model: {
                        __typename: "BVWizardAdvertiserVerificationEnterPhoneIXTScreenViewModel",
                        serialized_state: "whatsapp-state-1",
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
                    serialized_state: "whatsapp-state-2",
                    challenge_select_screen_content_renderer: {
                        bv_wizard_challenge_select_screen: {
                            challenge_method_options: ["SMS", "WHATSAPP_MESSAGE"],
                        },
                    },
                },
            },
        },
    }),
    successResponse({
        data: {
            ixt_screen_next: {
                view_model: {
                    __typename: "ChallengeWhatsAppConfirmIXTScreenViewModel",
                    serialized_state: "whatsapp-state-3",
                    challenge_whatsapp_confirm_screen_content_renderer: {
                        bv_wizard_challenge_whatsapp_confirm_screen: {
                            phone_number: "(730) 278-4461",
                        },
                    },
                },
            },
        },
    }),
    successResponse({
        data: {
            ixt_screen_next: {
                view_model: {
                    __typename: "ChallengeWhatsAppEnterCodeIXTScreenViewModel",
                    serialized_state: "whatsapp-state-4",
                },
            },
        },
    }),
]);
const whatsappResult = await requestPhoneVerificationCode({
    page: whatsappPage,
    adAccountId: "act_123",
    phoneE164: "+17302784461",
    countryCode: "US",
    locale: "en_GB",
    method: "WHATSAPP_MESSAGE",
    triggerSessionId: "whatsapp-trigger-session",
});
assert.equal(whatsappResult.success, true);
assert.equal(
    whatsappResult.status,
    requestPhoneVerificationCodeStatuses.WHATSAPP_CODE_SENT
);
assert.equal(whatsappResult.data.flow.serializedState, "whatsapp-state-4");
const sendWhatsappParameters = new URLSearchParams(whatsappPage.calls[3].requestBody);
assert.deepEqual(
    JSON.parse(sendWhatsappParameters.get("variables")).input.challenge_whatsapp_confirm,
    {
        phone_number: "(730) 278-4461",
        serialized_state: "whatsapp-state-3",
    }
);

const whatsappSubmitPage = createPage([successResponse({
    data: {
        ixt_screen_next: null,
    },
})]);
const whatsappSubmitResult = await submitPhoneVerificationCode({
    page: whatsappSubmitPage,
    flow: whatsappResult.data.flow,
    code: "123456",
});
assert.equal(whatsappSubmitResult.success, true);
const whatsappSubmitParameters = new URLSearchParams(whatsappSubmitPage.calls[0].requestBody);
assert.deepEqual(
    JSON.parse(whatsappSubmitParameters.get("variables")).input.challenge_whatsapp_enter_code,
    {
        check_id: null,
        code: "123456",
        serialized_state: "whatsapp-state-4",
    }
);

const rejectedWhatsappCodeResult = await submitPhoneVerificationCode({
    page: createPage([successResponse({
        data: { ixt_screen_next: null },
        errors: [{
            code: 1752126,
            api_error_code: 100,
            summary: "Invalid confirmation code",
        }],
    })]),
    flow: whatsappResult.data.flow,
    code: "123456",
});
assert.equal(rejectedWhatsappCodeResult.success, false);
assert.equal(
    rejectedWhatsappCodeResult.status,
    submitPhoneVerificationCodeStatuses.CODE_REJECTED
);
assert.equal(rejectedWhatsappCodeResult.error, "Невірний або прострочений код підтвердження");

const unsupportedMethodResult = await requestPhoneVerificationCode({
    page: createPage([]),
    adAccountId: "act_123",
    phoneE164: "+17302784461",
    countryCode: "US",
    locale: "en_GB",
    method: "ROBOCALL",
});

assert.equal(unsupportedMethodResult.success, false);
assert.equal(
    unsupportedMethodResult.status,
    requestPhoneVerificationCodeStatuses.METHOD_NOT_IMPLEMENTED
);

console.log("Перевірка Facebook actions phone verification пройшла успішно");
