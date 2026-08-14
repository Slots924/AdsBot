import detectLoginStatus from "./detectLoginStatus.js";
import loginInLoggedOut from "./loginInLoggedOut.js";
import loginInLoginRequired from "./loginInLoginRequired.js";


async function ensureLogin(page) {
    try {
        const loginStatus = await detectLoginStatus(page);

        if (loginStatus === "LOGGED_IN") {
            return true;
        }

        let loginSucceeded = false;

        if (loginStatus === "LOGGED_OUT") {
            loginSucceeded = await loginInLoggedOut(page);
        } else if (loginStatus === "LOGIN_REQUIRED") {
            loginSucceeded = await loginInLoginRequired(page);
        }

        if (!loginSucceeded) {
            return false;
        }

        return await detectLoginStatus(page) === "LOGGED_IN";
    } catch {
        return false;
    }
}


export default ensureLogin;
