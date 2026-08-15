import isAutomatedBehavior from "./checks/isAutomatedBehavior.js";
import isBanned from "./checks/isBanned.js";
import isNotice from "./checks/isNotice.js";
import isReady from "./checks/isReady.js";


async function detectFacebookState(page) {
    await new Promise((resolve) => {
        setTimeout(resolve, 3000);
    });

    if (await isAutomatedBehavior(page)) {
        return "AUTOMATED_BEHAVIOR";
    }

    if (await isBanned(page)) {
        return "BANNED";
    }

    if (await isNotice(page)) {
        return "NOTICE";
    }

    if (await isReady(page)) {
        return "READY";
    }

    return "UNKNOWN";
}


export default detectFacebookState;
