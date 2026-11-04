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

// Браузерний сервіс використовує ці пакети для підготовки Billing runtime у вкладці.
// HTTP-завантажувач має окремий механізм пошуку та не використовує цей список.
export const billingRuntimeModuleChunks = Object.freeze([
    {
        name: "BillingProtectedString",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4i-sZ4/yN/l/en_GB-j/_Xc03kAy42K.js",
        moduleNames: ["BillingProtectedString"],
    },
    {
        name: "FrontierPM card assets",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4iMLq4/y2/l/en_GB-j/hXHc1K_nBLw.js",
        moduleNames: ["FrontierPMAmericanExpressCard", "FrontierPMDinersClubCard", "FrontierPMDiscoverCard",
            "FrontierPMJCBCard", "FrontierPMMastercardCard", "FrontierPMVisaCard"],
    },
    {
        name: "BillingCreditCardUtils",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4iSwq4/yu/l/en_GB-j/HAismX0HAm7.js",
        moduleNames: ["BillingCreditCardUtils"],
    },
    {
        name: "BillingSaveCardCredentialStateMutation.graphql",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4i3dl4/yH/l/en_GB-j/j2_ypcBNBxs.js",
        moduleNames: ["BillingSaveCardCredentialStateMutation.graphql"],
    },
    {
        name: "BillingCheckRiskStateQuery.graphql",
        url: "https://static.xx.fbcdn.net/rsrc.php/v4i38S4/ys/l/en_GB-j/e50AF4rQD_S.js",
        moduleNames: ["BillingCheckRiskStateQuery.graphql"],
    },
]);
