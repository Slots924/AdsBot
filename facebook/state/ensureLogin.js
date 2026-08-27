import detectLoginStatus from "./detectLoginStatus.js";
import login from "./login.js";


async function ensureLogin(page, options = {}) {
    try {
        const loginStatus = await detectLoginStatus(page);

        if (loginStatus === "LOGGED_IN") {
            return true;
        }

        const loginSucceeded = await login(page, options);

        if (!loginSucceeded) {
            return false;
        }

        return await detectLoginStatus(page) === "LOGGED_IN";
    } catch {
        return false;
    }
}


export default ensureLogin;
