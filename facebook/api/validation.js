export function normalizeAdAccountId(value) {
    const id = String(value ?? "").trim();
    if (!/^act_\d+$/.test(id)) {
        const error = new Error("Некоректний Graph ID рекламного акаунта");
        error.code = "FACEBOOK_AD_ACCOUNT_ID_INVALID";
        throw error;
    }
    return id;
}


export function createValidationError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}


export function requireCreatedObjectId(response) {
    const value = response?.id;
    const id = typeof value === "string" ? value.trim()
        : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : "";
    if (!id || id === "undefined" || id === "null" || id === "0") {
        const error = createValidationError(
            "Meta не повернула ID створеного об’єкта. Результат запису невідомий; перевірте Ads Manager перед повторним запуском.",
            "FACEBOOK_WRITE_OUTCOME_UNKNOWN"
        );
        error.reason = "CREATED_OBJECT_ID_MISSING";
        error.outcomeUnknown = true;
        error.retryable = false;
        throw error;
    }
    return value;
}


export function normalizeObjectId(value, code, label) {
    const id = String(value ?? "").trim();
    if (!/^\d+$/.test(id)) {
        throw createValidationError(`Некоректний ${label}`, code);
    }
    return id;
}
