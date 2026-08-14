async function isCheckpoint(page) {
    // Умову визначення стану CHECKPOINT буде додано пізніше
    return false;
}


async function isBanned(page) {
    // Умову визначення стану BANNED буде додано пізніше
    return false;
}


async function isNotice(page) {
    // Умову визначення стану NOTICE буде додано пізніше
    return false;
}


async function isReady(page) {
    // Умову визначення стану READY буде додано пізніше
    return false;
}


async function detectFacebookState(page) {
    if (await isCheckpoint(page)) {
        return "CHECKPOINT";
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
