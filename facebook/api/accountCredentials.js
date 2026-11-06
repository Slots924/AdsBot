export const defaultAfpUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

export function getAccountTokenMode(account) {
    return (account.kind || "api") === "api" && account.tokenMode === "afp" ? "afp" : "access";
}

export function getAccountCredentials(account) {
    const afp = getAccountTokenMode(account) === "afp";
    return {
        accessToken: String((afp ? account.afpToken : account.accessToken) ?? "").trim(),
        userAgent: String((afp ? account.afpUserAgent || defaultAfpUserAgent : account.userAgent) ?? "").trim(),
        cookie: afp ? "" : String(account.cookie ?? "").trim(),
    };
}
