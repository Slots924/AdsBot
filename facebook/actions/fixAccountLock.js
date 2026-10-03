import recoverLockedAccount from "../workflows/recoverLockedAccount.js";

export default async function fixAccountLock(page, options = {}) {
    const result = await recoverLockedAccount(page, options);
    if (typeof options.onRecoveryResult === "function") await options.onRecoveryResult(result);
    return result.recovered && (!result.passwordChanged || result.credentialsSaved);
}
