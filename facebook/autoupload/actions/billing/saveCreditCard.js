import { actionError } from "../../graphql/errors.js";
import { isCardAccountLimitError } from "../../../api/billingCardErrors.js";

export const cardStatuses = Object.freeze({
    ADDED: "ADDED", CARD_ACCOUNT_LIMIT_REACHED: "CARD_ACCOUNT_LIMIT_REACHED",
    AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED", CARD_SAVE_REJECTED: "CARD_SAVE_REJECTED",
    REQUIRES_RISK_VERIFICATION: "REQUIRES_RISK_VERIFICATION", RISK_CHECK_FAILED: "RISK_CHECK_FAILED",
});

// Внутрішній крок: один запис карти та окреме контрольне читання, без повторів mutation.
export default async function saveCreditCard(page, { accountId, mutationId, riskQueryId, input }) {
    let data;
    try {
        data = await page.graphql("BillingSaveCardCredentialStateMutation", mutationId, {
            input, paymentAccountID: accountId, getRiskVerificationInfoForAllCredentialsOnPaymentAccount: true,
            includeCreateNewFromOldFragment: false,
        });
    } catch (error) {
        error.encryptionSucceeded = true;
        error.stage = "CARD_SAVE";
        if (!isCardAccountLimitError(error)) throw error;
        return { success: false, status: cardStatuses.CARD_ACCOUNT_LIMIT_REACHED, stage: "CARD_SAVE",
            graphCode: error.graphCode ?? error.apiErrorCode ?? 4992003, httpStatus: error.httpStatus ?? null,
            retryable: false, outcomeUnknown: false,
            data: { encryptionSucceeded: true, cardSaved: false, paymentMethodId: null },
            error: "Перевищено ліміт рекламних акаунтів для цієї карти. Видаліть її з іншого РК або використайте іншу карту." };
    }
    const saved = data?.xfb_billing_save_card_credential;
    const credential = saved?.credit_card?.credential_id;
    if (!credential) {
        page.writeBlocked = true;
        const error = actionError("Facebook не підтвердив результат збереження карти. Перевірте способи оплати перед повтором",
            "FACEBOOK_WRITE_NOT_CONFIRMED", { outcomeUnknown: true, stage: "CARD_SAVE", encryptionSucceeded: true });
        page.failure = error;
        throw error;
    }
    const verificationStatus = saved.card_verification_status;
    const resultData = { paymentMethodId: String(credential), verificationStatus, encryptionSucceeded: true, cardSaved: true };
    if (verificationStatus !== "SUCCESS") return { success: false,
        status: verificationStatus === "AUTHENTICATION_REQUIRED" ? cardStatuses.AUTHENTICATION_REQUIRED : cardStatuses.CARD_SAVE_REJECTED,
        stage: "CARD_SAVE", data: resultData, error: "Карту збережено; потрібна додаткова перевірка Facebook" };
    try {
        const risk = await page.graphql("BillingCheckRiskStateQuery", riskQueryId, {
            paymentAccountID: accountId, paymentMethodID: String(credential),
            getRiskVerificationInfoForAllCredentialsOnPaymentAccount: false,
        });
        const billable = risk?.payment_account?.billable_account;
        if (!billable || !Object.hasOwn(billable, "specific_credential_required_risk_verification_info")) {
            throw actionError("Неповна відповідь перевірки карти", "BILLING_RISK_RESPONSE_INVALID");
        }
        if (billable.specific_credential_required_risk_verification_info) return { success: false,
            status: cardStatuses.REQUIRES_RISK_VERIFICATION, stage: "RISK_CHECK", data: resultData,
            error: "Карту збережено; Facebook вимагає додаткової перевірки" };
    } catch (error) {
        return { success: false, status: cardStatuses.RISK_CHECK_FAILED, stage: "RISK_CHECK", data: resultData,
            error: "Карту збережено, але перевірити її стан не вдалося. Не додавайте її повторно",
            graphCode: error.graphCode ?? null, sessionStatus: error.sessionStatus ?? null };
    }
    return { success: true, status: cardStatuses.ADDED, data: resultData, error: null };
}
