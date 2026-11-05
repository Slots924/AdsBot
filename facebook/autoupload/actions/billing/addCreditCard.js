import { tracedAction } from "../../../../services/reports/HttpExchangeTrace.js";
import FacebookBillingModules from "../../encryption/FacebookBillingModules.js";
import HttpAdsManagerContext from "../../HttpAdsManagerContext.js";
import { actionError } from "../../graphql/errors.js";
import { randomUUID, X509Certificate, webcrypto } from "node:crypto";
import billingPaymentResources from "../../encryption/billingPaymentResources.js";
import saveCreditCard, { cardStatuses } from "./saveCreditCard.js";
export { cardStatuses as addCreditCardStatuses };
import { buildBillingPaymentSettingsUrl } from "../../../api/billingResources.js";

function serverKey(trustChain, modules) {
    if (!Array.isArray(trustChain) || trustChain.length < 2) throw actionError("Не отримано ланцюжок сертифікатів Meta", "BILLING_CERTIFICATE_REQUIRED");
    const source = modules.definitions.get("FBPayAuthLibraryUtils")?.source || "";
    const rootValue = [...source.matchAll(/["']([A-Za-z0-9+/=]{200,})["']/g)].map(match => match[1]).find(value => {
        try { return new X509Certificate(Buffer.from(value, "base64")).subject.includes("Facebook Payments Root CA"); } catch { return false; }
    });
    if (!rootValue) throw actionError("Не знайдено кореневий сертифікат Meta", "BILLING_ROOT_CERTIFICATE_REQUIRED");
    const chain = [...trustChain, rootValue].map(value => new X509Certificate(Buffer.from(value, "base64")));
    const now = Date.now();
    if (chain.some(cert => now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo))
        || chain.some((cert, index) => index < chain.length - 1 && !cert.verify(chain[index + 1].publicKey))) {
        throw actionError("Сертифікат шифрування Meta не пройшов перевірку", "BILLING_CERTIFICATE_INVALID");
    }
    const compactDate = value => new Date(value).toISOString().replace(/[-:T]/g, "").slice(2, 14) + "Z";
    // Нативний модуль Meta експортує відкритий ключ для обчислення його відбитка.
    return webcrypto.subtle.importKey("spki", chain[0].publicKey.export({ type: "spki", format: "der" }),
        { name: "ECDH", namedCurve: "P-256" }, true, []).then(key => ({ key,
        validity: { notBefore: compactDate(chain[0].validFrom), notAfter: compactDate(chain[0].validTo) } }));
}

async function addCreditCard(client, { profileId, adAccountId, card, signal, resourceHints, resources = billingPaymentResources, context } = {}) {
    const id = String(adAccountId || "").replace(/^act_/, "");
    if (!/^\d+$/.test(id) || !/^\d{12,19}$/.test(String(card?.cardNumber || "")) || !/^\d{3,4}$/.test(String(card?.securityCode || "")) || !/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(card?.expiration || ""))) throw actionError("Некоректні платіжні дані", "INVALID_INPUT");
    if (context && (!(context instanceof HttpAdsManagerContext) || context.client !== client || context.profileId !== profileId)) {
        throw actionError("Контекст платіжного запиту не відповідає сесії", "FACEBOOK_SESSION_MISMATCH");
    }
    const page = context || new HttpAdsManagerContext(client, profileId, { signal });
    signal?.throwIfAborted();
    if (page.writeBlocked) throw actionError("Перевірте результат попередньої дії перед повтором", "FACEBOOK_WRITE_OUTCOME_UNKNOWN", { outcomeUnknown: true });
    const billingUrl = buildBillingPaymentSettingsUrl(id);
    const response = await client.request({ url: billingUrl, signal, historyPurpose: "runtime" });
    const modules = new FacebookBillingModules(client, { signal });
    modules.readManifest(response.data);
    await modules.loadRoots(["FBPayAuthLibraryCommon", "FBPayAuthLibraryUtils", "FBPayBase64URL", "PaymentsCometGetServerEncryptionKeyMutation.graphql", "BillingSaveCardCredentialStateMutation.graphql", "BillingCheckRiskStateQuery.graphql"], {
        resourceHints, resources,
        refreshManifest: async () => (await client.request({ url: billingUrl, signal, historyPurpose: "runtime" })).data,
    });
    // Mutation дозволяється лише після отримання справжнього PTT від модулів Meta.
    const crypto = modules.require("FBPayAuthLibraryCommon");
    if (typeof crypto.createPttGeneric !== "function") throw actionError("Модуль шифрування не має очікуваного контракту", "BILLING_ENCRYPTION_CONTRACT_INVALID");
    const encoder = modules.require("FBPayBase64URL");
    const keyMutation = modules.require("PaymentsCometGetServerEncryptionKeyMutation.graphql");
    const mutation = modules.require("BillingSaveCardCredentialStateMutation.graphql");
    const riskQuery = modules.require("BillingCheckRiskStateQuery.graphql");
    if (typeof encoder.encode !== "function" || !/^\d+$/.test(String(keyMutation?.params?.id || ""))
        || !/^\d+$/.test(String(mutation?.params?.id || "")) || !/^\d+$/.test(String(riskQuery?.params?.id || ""))) {
        throw actionError("Платіжні модулі не мають очікуваного контракту", "BILLING_ENCRYPTION_CONTRACT_INVALID");
    }
    const [month, year] = card.expiration.split("/");
    const authData = { credit_card: "$e2ee", csc: "$e2ee", expiry_month: String(Number(month)), expiry_year: `20${year}` };
    const keyData = await page.graphql("PaymentsCometGetServerEncryptionKeyMutation", keyMutation.params.id,
        { input: { client_mutation_id: randomUUID(), device_id: "device_id", payment_type: "BILLING_WIZARD", target_account_id: id, fetch_unified_wallet_key: false, logging_id: null } });
    const serverKeyObject = await serverKey(keyData?.get_server_encryption_key?.trust_chain, modules);
    const token = await crypto.createPttGeneric(encoder.encode(JSON.stringify({ data: authData, nonce: randomUUID(), op: "ADD_CARD", ver: 1 })),
        { secretPayload: { credit_card: card.cardNumber, csc: card.securityCode }, serverKeyObject });
    if (!token || typeof token !== "string") throw actionError("Не отримано захищений токен карти", "PTT_GENERATION_FAILED");
    return saveCreditCard(page, { accountId: id, mutationId: mutation.params.id, riskQueryId: riskQuery.params.id,
        input: { billing_address: { country_code: card.countryCode, zip: card.postalCode || undefined },
            card_data: { bin: card.cardNumber.slice(0, 6), cardholder_name: card.cardholderName,
                credit_card_number: { sensitive_string_value: authData.credit_card }, csc: { sensitive_string_value: authData.csc },
                expiry_month: authData.expiry_month, expiry_year: authData.expiry_year, last_4: card.cardNumber.slice(-4) },
            payment_account_id: id, payment_intent: "ADD_PM", platform_trust_token: token,
            set_default: false, recurring_payment_consent_given: false, network_tokenization_consent_given: false,
            skip_cvv_for_eea_save: false, is_hardware_backed_crypto_available: false },
    });
}

export default tracedAction("addCreditCard", addCreditCard, (_, input) => ({ profileId: input?.profileId }));
