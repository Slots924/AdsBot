import readAdAccountFields from "./readAdAccountFields.js";

const accountFields = "id,account_id,currency,timezone_name";
const businessFields = "business_name,business_country_code,business_state,business_city,business_zip,business_street,business_street2";

// Читає дані вибраного рекламного акаунта в його браузерній сесії.
export default async function getAdAccountBusinessInfo({ page, accessToken, adAccountId, timeout = 60000 }) {
    const accountId = String(adAccountId ?? "").replace(/^act_/, "").trim();
    const response = await readAdAccountFields({
        page, accessToken, adAccountId, timeout, fieldGroups: [accountFields, businessFields],
    });
    if (!response.success) return response;
    const data = response.data;
    return {
        success: true,
        status: "CHECKED",
        data: {
            adAccountId: accountId,
            businessName: data.business_name ?? "",
            countryCode: data.business_country_code ?? "",
            currency: data.currency ?? "",
            timezone: data.timezone_name ?? "",
            street1: data.business_street ?? "",
            street2: data.business_street2 ?? "",
            city: data.business_city ?? "",
            state: data.business_state ?? "",
            zip: data.business_zip ?? "",
        },
    };
}
