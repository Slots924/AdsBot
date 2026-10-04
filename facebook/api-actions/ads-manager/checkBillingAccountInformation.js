import {
    buildMutationBody,
    createResult,
    hasGraphqlErrors,
    normalizeTimeout,
    parseFacebookJson,
    postFacebookForm,
    validateMutationInput,
} from "../education/common.js";


const billingAccountInformationFriendlyName = "BillingAccountInformationScreenQuery";
const billingAccountInformationDocId = "28130792889912915";
const taxInfoProblemFlag = "TAX_INFO_PROBLEM_SOFT_CRTICAL";


export const checkBillingAccountInformationStatuses = Object.freeze({
    CHECKED: "CHECKED",
    PAYMENT_ACCOUNT_NOT_FOUND: "PAYMENT_ACCOUNT_NOT_FOUND",
    INVALID_INPUT: "INVALID_INPUT",
    REQUEST_TIMEOUT: "REQUEST_TIMEOUT",
    HTTP_ERROR: "HTTP_ERROR",
    PARSE_ERROR: "PARSE_ERROR",
    GRAPHQL_ERROR: "GRAPHQL_ERROR",
    REQUEST_FAILED: "REQUEST_FAILED",
    ERROR: "ERROR",
});


// Нормалізує billing info та визначає потребу Business info за server-side billing flag.
function parseBillingAccountInformation(data, paymentAccountId) {
    const paymentAccount = data?.data?.payment_account ?? null;
    if (!paymentAccount) return null;

    const problems = Array.isArray(paymentAccount.billing_flags)
        ? paymentAccount.billing_flags
        : [];
    const taxInfo = paymentAccount?.billable_account?.billable_account_tax_info ?? null;
    const businessInfo = {
        businessName: taxInfo?.business_name ?? null,
        businessCountryCode: taxInfo?.business_country_code ?? null,
        predictedBusinessCountryCode: taxInfo?.predicated_business_country_code ?? null,
        address: {
            street: taxInfo?.intl_address?.street ?? null,
            building: taxInfo?.intl_address?.building ?? null,
            city: taxInfo?.intl_address?.city ?? null,
            region: taxInfo?.intl_address?.region ?? null,
            postalCode: taxInfo?.intl_address?.postal_code ?? null,
        },
        taxId: taxInfo?.tax_id ?? null,
        secondTaxId: taxInfo?.second_tax_id ?? null,
        taxRegistrationStatus: taxInfo?.tax_registration_status ?? null,
        taxIdType: taxInfo?.tax_id_type_enum ?? null,
        isPersonal: taxInfo?.is_personal ?? null,
        businessVerificationType: taxInfo?.business_verification_type ?? null,
    };
    const missingFields = [];
    if (!businessInfo.businessName?.trim()) missingFields.push("business_name");
    if (!businessInfo.address.street?.trim()) missingFields.push("street");
    if (!businessInfo.address.city?.trim()) missingFields.push("city");
    if (!businessInfo.address.postalCode?.trim()) missingFields.push("postal_code");

    return {
        paymentAccountId,
        needsBusinessInfo: problems.includes(taxInfoProblemFlag),
        problems,
        missingFields,
        businessInfo,
    };
}


// Зчитує billing tax info рекламного акаунта без будь-яких змін на стороні Meta.
export default async function checkBillingAccountInformation({
    page,
    commonPayload,
    paymentAccountId,
    timeout,
}) {
    const validationError = validateMutationInput(page, commonPayload, { requireAv: false });
    const missingRequestField = ["__spin_r", "__spin_b", "__spin_t"]
        .find((field) => commonPayload?.[field] === undefined || commonPayload[field] === null);
    const normalizedPaymentAccountId = String(paymentAccountId ?? "").trim();

    if (validationError || missingRequestField || !normalizedPaymentAccountId) {
        return createResult(false, checkBillingAccountInformationStatuses.INVALID_INPUT, null, {
            error: validationError
                ?? (missingRequestField
                    ? `У commonPayload відсутнє поле ${missingRequestField}`
                    : "Потрібен paymentAccountId"),
        });
    }

    try {
        const body = buildMutationBody(commonPayload, {
            friendlyName: billingAccountInformationFriendlyName,
            docId: billingAccountInformationDocId,
            variables: {
                paymentAccountID: normalizedPaymentAccountId,
            },
            extraParameters: {
                __aaid: normalizedPaymentAccountId,
                __spin_r: commonPayload.__spin_r,
                __spin_b: commonPayload.__spin_b,
                __spin_t: commonPayload.__spin_t,
                __crn: commonPayload.__crn,
                ads_manager_write_regions: "true",
            },
        });
        const response = await postFacebookForm(page, {
            body,
            friendlyName: billingAccountInformationFriendlyName,
            lsd: commonPayload.lsd,
            timeout: normalizeTimeout(timeout),
        });

        if (response.requestError === "TIMEOUT") {
            return createResult(false, checkBillingAccountInformationStatuses.REQUEST_TIMEOUT);
        }
        if (response.requestError) {
            return createResult(false, checkBillingAccountInformationStatuses.REQUEST_FAILED, null, {
                error: response.requestError,
            });
        }
        if (!response.ok) {
            return createResult(false, checkBillingAccountInformationStatuses.HTTP_ERROR, null, {
                httpStatus: response.statusCode,
            });
        }

        let data;
        try {
            data = parseFacebookJson(response.body);
        } catch (error) {
            return createResult(false, checkBillingAccountInformationStatuses.PARSE_ERROR, null, {
                error: String(error?.message ?? error),
                httpStatus: response.statusCode,
            });
        }
        if (hasGraphqlErrors(data)) {
            return createResult(false, checkBillingAccountInformationStatuses.GRAPHQL_ERROR, data, {
                httpStatus: response.statusCode,
            });
        }

        const billingInfo = parseBillingAccountInformation(data, normalizedPaymentAccountId);
        if (!billingInfo) {
            return createResult(
                false,
                checkBillingAccountInformationStatuses.PAYMENT_ACCOUNT_NOT_FOUND,
                null,
                { httpStatus: response.statusCode }
            );
        }

        return createResult(true, checkBillingAccountInformationStatuses.CHECKED, billingInfo, {
            httpStatus: response.statusCode,
        });
    } catch (error) {
        return createResult(false, checkBillingAccountInformationStatuses.ERROR, null, {
            error: String(error?.message ?? error),
        });
    }
}
