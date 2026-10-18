import { readFacebookRuntime } from "../../api/runtime.js";
import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../../api/browserRequest.js";


const inviteFriendlyName = "ProfilePlusCoreAppAdminInviteMutation";
const inviteDocId = "27622438327347937";


export const inviteAdditionalProfileAdminStatuses = Object.freeze({
    INVITE_SENT: "INVITE_SENT",
    INVITE_NOT_SENT: "INVITE_NOT_SENT",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Відправляє користувачу invite на Full Access до additional profile.
// additionalProfileId — це additional_profile.id, а не звичайний Graph page.id.
// Перед викликом Facebook-сесія має бути вже reauthed, якщо цього вимагає поточний Page Plus flow.
export default async function inviteAdditionalProfileAdmin({
    page,
    additionalProfileId,
    targetUserId,
    timeout,
}) {
    const runtimeContext = await readFacebookRuntime(page, { surface: "facebook", timeout });
    const validationError = validateMutationInput(page, runtimeContext);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t"]
        .find((field) => runtimeContext?.[field] === undefined || runtimeContext[field] === null);
    const normalizedAdditionalProfileId = String(additionalProfileId ?? "").trim();
    const normalizedTargetUserId = String(targetUserId ?? "").trim();

    if (validationError || missingRequestField || !/^\d+$/.test(normalizedAdditionalProfileId)
        || !/^\d+$/.test(normalizedTargetUserId)) {
        return createResult(false, inviteAdditionalProfileAdminStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У runtimeContext відсутнє поле ${missingRequestField}`
                    : "Потрібні числові additionalProfileId і targetUserId"),
        });
    }

    if (String(runtimeContext.av) !== normalizedAdditionalProfileId) {
        return createResult(false, inviteAdditionalProfileAdminStatuses.INVALID_INPUT, null, {
            error: "Поточний Facebook actor не відповідає additionalProfileId",
        });
    }

    try {
        const body = buildMutationBody(runtimeContext, {
            friendlyName: inviteFriendlyName,
            docId: inviteDocId,
            variables: {
                input: {
                    additional_profile_id: normalizedAdditionalProfileId,
                    admin_id: normalizedTargetUserId,
                    grant_full_control: true,
                    actor_id: normalizedAdditionalProfileId,
                    client_mutation_id: "2",
                },
                scale: 1,
            },
            extraParameters: {
                __spin_r: runtimeContext.__spin_r,
                __spin_b: runtimeContext.__spin_b,
                __spin_t: runtimeContext.__spin_t,
                __crn: runtimeContext.__crn,
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: inviteFriendlyName,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, inviteAdditionalProfileAdminStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, inviteAdditionalProfileAdminStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, inviteAdditionalProfileAdminStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, inviteAdditionalProfileAdminStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, inviteAdditionalProfileAdminStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        const invite = data?.data?.profile_plus_core_admin_invite ?? null;
        if (invite?.is_invite_sent !== true) {
            return createResult(false, inviteAdditionalProfileAdminStatuses.INVITE_NOT_SENT, data, {
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, inviteAdditionalProfileAdminStatuses.INVITE_SENT, {
            additionalProfileId: normalizedAdditionalProfileId,
            targetUserId: normalizedTargetUserId,
            adminType: invite.admin_type ?? null,
            permissions: Array.isArray(invite.permissions) ? invite.permissions : [],
            profileAdminInviteId: invite.profile_admin_invite_id ?? null,
            daysUntilExpiration: invite.days_until_expiration ?? null,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, inviteAdditionalProfileAdminStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
