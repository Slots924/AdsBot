export function buildBillingPaymentSettingsUrl(adAccountId) {
    const id = String(adAccountId ?? "").replace(/^act_/, "").trim();
    if (!/^\d+$/.test(id)) throw new Error("Некоректний ID платіжного акаунта");
    const url = new URL("https://adsmanager.facebook.com/adsmanager/billing_hub/payment_settings/");
    url.searchParams.set("nav_entry_point", "ads_ecosystem_navigation_menu");
    url.searchParams.set("placement", "ads_manager");
    url.searchParams.set("asset_id", id);
    url.searchParams.set("payment_account_id", id);
    return url.href;
}
