import {
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    validateMutationInput,
} from "../education/common.js";


const reauthFriendlyName = "ProfilePlusMarkReauthedMutation";
const reauthDocId = "24066063156313418";
const encryptionQueryModule = "CometProfilePlusAdminPermissionsRootQuery.graphql";


export const reauthAdditionalProfileAdminStatuses = Object.freeze({
    REAUTHENTICATED: "REAUTHENTICATED",
    REAUTH_NOT_CONFIRMED: "REAUTH_NOT_CONFIRMED",
    RUNTIME_KEYS_UNAVAILABLE: "RUNTIME_KEYS_UNAVAILABLE",
    RUNTIME_MODULE_UNAVAILABLE: "RUNTIME_MODULE_UNAVAILABLE",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Формує reauth-запит у контексті сторінки, щоб пароль і protected payload не покидали browser runtime.
async function submitReauthInPage(page, {
    commonPayload,
    additionalProfileId,
    password,
    timeout,
}) {
    return page.evaluate(
        async ({ payload, profileId, plaintextPassword, timeoutMs }) => {
            const getEncryptionKeys = async () => {
                const Relay = require("CometRelay");
                const environment = require("RelayFBEnvironment");
                const query = require("CometProfilePlusAdminPermissionsRootQuery.graphql");

                return new Promise((resolve, reject) => {
                    Relay.fetchQuery(
                        environment,
                        query,
                        { scale: window.devicePixelRatio || 1 }
                    ).subscribe({
                        next(data) {
                            try {
                                const actorId = data?.viewer?.actor?.__id
                                    ?? environment.actorIdentifier;
                                const source = environment.getStore?.().getSource?.();
                                const actor = actorId ? source?.get(actorId) : null;
                                const keyRecordId = actor?.public_key_and_id_for_encryption?.__ref;
                                const keyRecord = keyRecordId ? source?.get(keyRecordId) : null;

                                if (!keyRecord?.key_id || !keyRecord?.public_key) {
                                    throw new Error("RUNTIME_ENCRYPTION_KEYS_UNAVAILABLE");
                                }
                                resolve({ keyId: keyRecord.key_id, publicKey: keyRecord.public_key });
                            } catch (error) {
                                reject(error);
                            }
                        },
                        error: reject,
                    });
                });
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const { keyId, publicKey } = await getEncryptionKeys();
                const encryptedPassword = await require("FBBrowserPasswordEncryption").encryptPassword(
                    keyId,
                    publicKey,
                    plaintextPassword,
                    Math.floor(Date.now() / 1000).toString()
                );
                const parameters = new URLSearchParams({
                    ...(payload.av ? { av: String(payload.av) } : {}),
                    __user: String(payload.__user),
                    __a: String(payload.__a),
                    fb_dtsg: String(payload.fb_dtsg),
                    jazoest: String(payload.jazoest),
                    lsd: String(payload.lsd),
                    __comet_req: String(payload.__comet_req),
                    fb_api_caller_class: "RelayModern",
                    fb_api_req_friendly_name: "ProfilePlusMarkReauthedMutation",
                    server_timestamps: "true",
                    doc_id: "24066063156313418",
                    variables: JSON.stringify({
                        input: {
                            password: { sensitive_string_value: encryptedPassword },
                            actor_id: profileId,
                            client_mutation_id: "1",
                        },
                    }),
                    ...(payload.__spin_r ? { __spin_r: String(payload.__spin_r) } : {}),
                    ...(payload.__spin_b ? { __spin_b: String(payload.__spin_b) } : {}),
                    ...(payload.__spin_t ? { __spin_t: String(payload.__spin_t) } : {}),
                    ...(payload.__crn ? { __crn: String(payload.__crn) } : {}),
                });
                const response = await fetch("/api/graphql/", {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "x-fb-friendly-name": "ProfilePlusMarkReauthedMutation",
                        "x-fb-lsd": String(payload.lsd),
                    },
                    body: parameters.toString(),
                    signal: controller.signal,
                });

                return { ok: response.ok, statusCode: response.status, body: await response.text() };
            } catch (error) {
                const message = String(error?.message ?? error);
                return {
                    requestError: error?.name === "AbortError" ? "TIMEOUT" : message,
                    runtimeKeysUnavailable: message.includes("RUNTIME_ENCRYPTION_KEYS_UNAVAILABLE"),
                    runtimeModuleUnavailable: message.includes("Cannot find module"),
                };
            } finally {
                clearTimeout(timeoutId);
            }
        },
        {
            payload: commonPayload,
            profileId: additionalProfileId,
            plaintextPassword: password,
            timeoutMs: timeout,
        }
    );
}


// Підтверджує поточну Meta-сесію перед видачею Full Access до additional profile.
export default async function reauthAdditionalProfileAdmin({
    page,
    commonPayload,
    additionalProfileId,
    password,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedProfileId = String(additionalProfileId ?? "").trim();
    const normalizedPassword = String(password ?? "");

    if (validationError || missingRequestField || !/^\d+$/.test(normalizedProfileId) || !normalizedPassword) {
        return createResult(false, reauthAdditionalProfileAdminStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібні числовий additionalProfileId і пароль"),
        });
    }

    try {
        const response = await submitReauthInPage(page, {
            commonPayload,
            additionalProfileId: normalizedProfileId,
            password: normalizedPassword,
            timeout: normalizeTimeout(timeout),
        });
        if (response.requestError === "TIMEOUT") {
            return createResult(false, reauthAdditionalProfileAdminStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            const status = response.runtimeKeysUnavailable
                ? reauthAdditionalProfileAdminStatuses.RUNTIME_KEYS_UNAVAILABLE
                : response.runtimeModuleUnavailable
                    ? reauthAdditionalProfileAdminStatuses.RUNTIME_MODULE_UNAVAILABLE
                    : reauthAdditionalProfileAdminStatuses.REQUEST_FAILED;
            return createResult(false, status, null, { error: response.requestError });
        }
        if (!response.ok) {
            return createResult(false, reauthAdditionalProfileAdminStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, reauthAdditionalProfileAdminStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, reauthAdditionalProfileAdminStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }
        if (data?.data?.admin_management_mark_reauthed?.reauth_is_successful !== true) {
            return createResult(false, reauthAdditionalProfileAdminStatuses.REAUTH_NOT_CONFIRMED, data, {
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, reauthAdditionalProfileAdminStatuses.REAUTHENTICATED, {
            additionalProfileId: normalizedProfileId,
        }, { httpStatus: response.statusCode });
    } catch (error) {
        return createResult(false, reauthAdditionalProfileAdminStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
