import readAdAccountFields from "./readAdAccountFields.js";

// Повертає лише джерела оплати, які Meta віддала для вибраного РК.
export default async function getAdAccountPaymentSources(input) {
    const response = await readAdAccountFields({
        ...input,
        fieldGroups: ["id,account_status,funding_source,funding_source_details"],
    });
    if (!response.success) return response;
    const data = response.data;
    if (!data.id) return { success: false, status: "EMPTY_RESPONSE", error: "Meta не повернула рекламний акаунт" };
    const details = Array.isArray(data.funding_source_details)
        ? data.funding_source_details : data.funding_source_details ? [data.funding_source_details] : [];
    const sources = [];
    const seen = new Set();
    for (const item of details) {
        if (!item || typeof item !== "object") continue;
        const id = String(item.id ?? data.funding_source ?? "");
        const displayString = String(item.display_string ?? "").trim();
        if (!id && !displayString) continue;
        const key = id || displayString;
        if (seen.has(key)) continue;
        seen.add(key);
        const maskMatch = displayString.match(/(?:[*•]\s*)+(\d{4})\s*$/);
        const last4 = maskMatch?.[1] ?? null;
        sources.push({ id: id || null, displayString: displayString || null,
            network: maskMatch ? displayString.slice(0, maskMatch.index).trim() || null : null,
            last4, type: item.type ?? null });
    }
    if (!sources.length && data.funding_source) {
        sources.push({ id: String(data.funding_source), displayString: null, network: null, last4: null, type: null });
    }
    return { success: true, status: "CHECKED", data: {
        adAccountId: String(data.id).replace(/^act_/, ""),
        accountStatus: data.account_status == null ? null : Number(data.account_status),
        sources,
        checkedAt: new Date().toISOString(),
    } };
}
