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


export function normalizeObjectId(value, code, label) {
    const id = String(value ?? "").trim();
    if (!/^\d+$/.test(id)) {
        throw createValidationError(`Некоректний ${label}`, code);
    }
    return id;
}
