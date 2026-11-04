// Код Meta означає ліміт рекламних акаунтів, до яких можна прив'язати цю карту.
export function isCardAccountLimitError(error) {
    if (!error || error.outcomeUnknown || error.sessionStatus) return false;
    const codes = [error.graphCode, error.apiErrorCode,
        ...(Array.isArray(error.errors) ? error.errors : []).flatMap(item => [item?.code, item?.api_error_code])].filter(value => value != null);
    if (codes.length) return codes.some(code => String(code) === "4992003");
    return error.code === "FACEBOOK_GRAPHQL_ERROR"
        && /remove it from another account/i.test(String(error.graphUserMessage || error.message || ""));
}
