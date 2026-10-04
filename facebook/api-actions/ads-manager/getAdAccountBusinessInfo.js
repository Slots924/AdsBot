const accountFields = "id,account_id,currency,timezone_name";
const businessFields = "business_name,business_country_code,business_state,business_city,business_zip,business_street,business_street2";

// Читає дані вибраного рекламного акаунта в його браузерній сесії.
export default async function getAdAccountBusinessInfo({ page, accessToken, adAccountId, timeout = 60000 }) {
    const token = String(accessToken ?? "").trim();
    const accountId = String(adAccountId ?? "").replace(/^act_/, "").trim();
    if (!page?.evaluate || !token || !/^\d+$/.test(accountId)) {
        return { success: false, status: "INVALID_INPUT", error: "Потрібні браузер, токен і ID рекламного акаунта" };
    }

    try {
        const response = await page.evaluate(async ({ tokenValue, id, fields, business, requestTimeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), requestTimeout);
            try {
                const read = async (selectedFields) => {
                    const query = new URLSearchParams({ fields: selectedFields, access_token: tokenValue });
                    const result = await fetch(`https://graph.facebook.com/v26.0/act_${id}?${query}`, {
                        credentials: "include",
                        signal: controller.signal,
                    });
                    const body = await result.json().catch(() => null);
                    if (!result.ok || body?.error) {
                        return { error: body?.error?.message ?? `Graph API: HTTP ${result.status}`, code: body?.error?.code ?? null };
                    }
                    return { data: body };
                };
                const basic = await read(fields);
                if (basic.error) return basic;
                const details = await read(business);
                if (details.error) return details;
                return { data: { ...basic.data, ...details.data } };
            } catch (error) {
                return { error: error?.name === "AbortError" ? "Час очікування Graph API вичерпано" : String(error?.message ?? error) };
            } finally {
                clearTimeout(timer);
            }
        }, { tokenValue: token, id: accountId, fields: accountFields, business: businessFields, requestTimeout: timeout });

        if (response?.error) {
            return { success: false, status: "GRAPH_API_ERROR", error: response.error, graphCode: response.code ?? null };
        }
        const data = response?.data;
        if (!data) return { success: false, status: "EMPTY_RESPONSE", error: "Graph API не повернув даних" };
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
    } catch (error) {
        return { success: false, status: "ERROR", error: String(error?.message ?? error) };
    }
}
