import { randomUUID } from "node:crypto";

import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const updateBusinessInfoFriendlyName = "BillingAccountInformationUtilsUpdateAccountMutation";
const updateBusinessInfoDocId = "28163983213226133";

const defaultBusinessAddress = Object.freeze({
    street1: "1600 Pennsylvania Avenue NW",
    street2: "",
    city: "Washington",
    state: "DC",
    zip: "20500",
    countryCode: "US",
});


export const updateBusinessInfoStatuses = Object.freeze({
    UPDATED: "UPDATED",
    UPDATE_RESULT_NOT_FOUND: "UPDATE_RESULT_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує business address у формат, якого очікує Billing Account mutation.
function normalizeBusinessAddress(address) {
    const source = address && typeof address === "object" ? address : {};

    return {
        street1: String(source.street1 ?? defaultBusinessAddress.street1).trim(),
        street2: String(source.street2 ?? defaultBusinessAddress.street2).trim(),
        city: String(source.city ?? defaultBusinessAddress.city).trim(),
        state: String(source.state ?? defaultBusinessAddress.state).trim(),
        zip: String(source.zip ?? defaultBusinessAddress.zip).trim(),
        countryCode: String(source.countryCode ?? defaultBusinessAddress.countryCode)
            .trim()
            .toUpperCase(),
    };
}


// Генерує технічні UPL-поля поточного запиту без використання даних із чужої сесії.
function createUplLoggingData(overrides = {}) {
    const flowId = `upl_${Date.now()}_${randomUUID()}`;

    return {
        billing_notification_id: "",
        context: "billingaccountinfo",
        entry_point: "ads_manager",
        external_flow_id: flowId,
        target_name: updateBusinessInfoFriendlyName,
        user_session_id: flowId,
        wizard_config_name: "BUSINESS_INFO_SUB",
        wizard_name: "COLLECT_ACCOUNT_INFO",
        wizard_screen_name: "account_information_state_display",
        wizard_session_id: `upl_wizard_${Date.now()}_${randomUUID()}`,
        ...overrides,
    };
}


// Витягує оновлені business info з mutation response для зручного використання caller-ом.
function extractBusinessInfo(data) {
    const billableAccount = data?.data?.billable_account_update?.payment_account
        ?.billable_account ?? null;
    const taxInfo = billableAccount?.billable_account_tax_info ?? null;

    return {
        adAccountId: billableAccount?.id ?? null,
        paymentLegacyAccountId: data?.data?.billable_account_update?.payment_account
            ?.payment_legacy_account_id ?? null,
        currency: billableAccount?.currency ?? null,
        timezone: billableAccount?.timezone_info?.timezone ?? null,
        businessName: taxInfo?.business_name ?? null,
        isPersonalUse: taxInfo?.is_personal ?? null,
        taxId: taxInfo?.tax_id ?? null,
        secondTaxId: taxInfo?.second_tax_id ?? null,
        address: taxInfo?.intl_address ?? null,
    };
}


// Оновлює business information платіжного рекламного акаунта однією GraphQL mutation.
export default async function updateBusinessInfo({
    page,
    commonPayload,
    billableAccountPaymentLegacyAccountId,
    currency = "USD",
    deviceCountry = null,
    tax = {},
    timezone = "Europe/Kiev",
    uplLoggingData = null,
    clientMutationId = "10",
    includeCreateNewFromOldFragment = false,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload);
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t", "__crn"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const accountId = String(billableAccountPaymentLegacyAccountId ?? "").trim();
    const normalizedCurrency = currency === null ? null : String(currency ?? "").trim().toUpperCase();
    const normalizedDeviceCountry = deviceCountry === null
        ? null
        : String(deviceCountry ?? "").trim().toUpperCase();
    const normalizedTimezone = String(timezone ?? "").trim();
    const normalizedMutationId = String(clientMutationId ?? "").trim();
    const address = normalizeBusinessAddress(tax.businessAddress);
    const normalizedTax = {
        businessAddress: address,
        businessName: String(tax.businessName ?? "").trim(),
        isPersonalUse: Boolean(tax.isPersonalUse ?? false),
        secondTaxId: String(tax.secondTaxId ?? "").trim(),
        taxId: String(tax.taxId ?? "").trim(),
        taxRegistrationStatus: String(tax.taxRegistrationStatus ?? "").trim(),
    };

    if (validationError || missingRequestField || !accountId || !normalizedTimezone
        || (normalizedCurrency !== null && !/^[A-Z]{3}$/.test(normalizedCurrency))
        || (normalizedDeviceCountry !== null && !/^[A-Z]{2}$/.test(normalizedDeviceCountry))
        || !address.street1 || !address.city || !address.state || !address.zip
        || !/^[A-Z]{2}$/.test(address.countryCode) || !normalizedMutationId
        || (uplLoggingData !== null && typeof uplLoggingData !== "object")) {
        return createResult(false, updateBusinessInfoStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібні ID платіжного акаунта, коректні currency/address/timezone та clientMutationId"),
        });
    }

    try {
        const body = buildMutationBody(commonPayload, {
            friendlyName: updateBusinessInfoFriendlyName,
            docId: updateBusinessInfoDocId,
            variables: {
                input: {
                    billable_account_payment_legacy_account_id: accountId,
                    currency: normalizedCurrency,
                    device_country: normalizedDeviceCountry,
                    tax: {
                        business_address: {
                            city: address.city,
                            country_code: address.countryCode,
                            state: address.state,
                            street1: address.street1,
                            street2: address.street2,
                            zip: address.zip,
                        },
                        business_name: normalizedTax.businessName,
                        is_personal_use: normalizedTax.isPersonalUse,
                        second_tax_id: normalizedTax.secondTaxId,
                        tax_id: normalizedTax.taxId,
                        tax_registration_status: normalizedTax.taxRegistrationStatus,
                    },
                    timezone: normalizedTimezone,
                    upl_logging_data: createUplLoggingData(uplLoggingData ?? {}),
                    actor_id: String(commonPayload.__user),
                    client_mutation_id: normalizedMutationId,
                },
                includeCreateNewFromOldFragment: Boolean(includeCreateNewFromOldFragment),
            },
            extraParameters: {
                __aaid: accountId,
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
                ads_manager_write_regions: "true",
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: updateBusinessInfoFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, updateBusinessInfoStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, updateBusinessInfoStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, updateBusinessInfoStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, updateBusinessInfoStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, updateBusinessInfoStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        const businessInfo = extractBusinessInfo(data);
        if (!businessInfo.paymentLegacyAccountId) {
            return createResult(false, updateBusinessInfoStatuses.UPDATE_RESULT_NOT_FOUND, data, {
                error: "Facebook не повернув оновлений платіжний рекламний акаунт",
                httpStatus: response.statusCode,
            });
        }

        return createResult(true, updateBusinessInfoStatuses.UPDATED, {
            businessInfo,
            response: data,
        }, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, updateBusinessInfoStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
